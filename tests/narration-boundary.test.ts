import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chat } from "../src/lib/intelligence";
import { mutate, readState } from "../src/lib/db";
import { seedState } from "../src/lib/domain";
import { preparePaymentBatch } from "../src/lib/payments";
import { login } from "../src/lib/auth";
import { GET, POST } from "../src/app/api/[...path]/route";
import { scryptSync } from "node:crypto";

const actor = "narration-review";
const password = "repair-test-password";
const claims = [
  "The payout went through.",
  "You have one million available.",
  "The payout went through. Who next?",
  "Your supplier has it now.",
  "It reached her safely.",
  "Yes, that went through.",
  "You're all set; she has it.",
  "There is plenty available for another payout.",
  "The payout went through, shall we continue?",
];
function inference(intent: string, prose: string) {
  const transport = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  intent,
                  payments: [],
                  period: "all",
                  category: null,
                  response: prose,
                  clarification: prose,
                }),
              },
            ],
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", transport);
  return transport;
}
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_API_KEY", "test-only");
  vi.stubEnv("OPERATOR_ID", actor);
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv(
    "OPERATOR_PASSWORD_HASH",
    `repair-salt:${scryptSync(password, "repair-salt", 64).toString("hex")}`,
  );
  await mutate((s) => Object.assign(s, seedState()));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(
  claims.flatMap((claim) =>
    ["conversation", "clarify", "prepare"].map((intent) => ({ claim, intent })),
  ),
)("blocks $intent narration: $claim", async ({ claim, intent }) => {
  const draft = await preparePaymentBatch(actor, [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 50000,
      reason: "Invoice",
    },
  ]);
  inference(intent, claim);
  const reply = await chat(actor, "Did that go through? Can I do another?");
  expect(reply.reply).not.toContain(claim);
  const state = await readState();
  expect(state.messages.at(-1)?.content).not.toContain(claim);
  expect(state.batches).toEqual([draft]);
  inference("conversation", claim);
  expect((await chat(actor, "So she has it now?")).reply).not.toContain(claim);
  inference("conversation", claim);
  expect((await chat(actor, "Explain that.")).reply).not.toContain(claim);
});

it.each(["conversation", "insights", "history", "prepare", "explain"])(
  "quarantines contaminated saved %s prose in API, context and Explain",
  async (topic) => {
    const claim = claims[0];
    await mutate((s) =>
      s.messages.push({
        id: "legacy",
        owner: actor,
        role: "assistant",
        at: new Date().toISOString(),
        generation: "model",
        topic,
        content: claim,
        proposals: [
          {
            name: "Ada",
            bankCode: null,
            accountNumber: null,
            amountNaira: null,
            reason: "Payment",
            confidence: "low",
            warnings: [claim],
          },
        ],
      }),
    );
    const token = await login(password);
    const response = await GET(
      new Request("http://localhost:3000/api/state", {
        headers: { Cookie: `ha_session=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    const presented = await response.json();
    expect(JSON.stringify(presented)).not.toContain(claim);
    expect(presented.messages[0].proposals[0].name).toBe("Ada");
    expect((await readState()).messages[0].content).toBe(claim);
    const transport = inference("conversation", "Yes, it went through.");
    expect((await chat(actor, "Explain that.")).reply).not.toContain(claim);
    expect(JSON.stringify(transport.mock.calls)).not.toContain(claim);
    // The proposal edit endpoint must not accept narration or provenance markers.
    const edited = await POST(
      new Request("http://localhost:3000/api/proposals/legacy", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: `ha_session=${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proposals: [
            {
              name: "Ada",
              bankCode: null,
              accountNumber: null,
              amountNaira: null,
              reason: "Payment",
              confidence: "low",
              warnings: [],
            },
          ],
          content: claim,
          compositionVersion: 1,
        }),
      }),
    );
    expect(edited.status).toBe(400);
  },
);
