import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chat } from "../src/lib/intelligence";
import { mutate, readState } from "../src/lib/db";
import { seedState } from "../src/lib/domain";
import { groundProposal } from "../src/lib/conversation-policy";

const actor = "conversation-test";
const base = {
  intent: "conversation",
  payments: [],
  period: "all",
  category: null,
};
function inference(plan: object) {
  const transport = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify({ ...base, ...plan }) }] },
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
  await mutate((s) => Object.assign(s, seedState()));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses actual generated conversational language and bounded actor-owned context", async () => {
  inference({
    response: "Hey there! What would you like help with today?",
  });
  expect((await chat(actor, "Hey.")).reply).toBe(
    "Hey there! What would you like help with today?",
  );
  await mutate((s) =>
    s.messages.push({
      id: "private",
      role: "assistant",
      content: "OTHER ACTOR PRIVATE",
      owner: "other",
      at: new Date().toISOString(),
    }),
  );
  const nextTransport = inference({
    response: "You’re welcome. What would you like to explore next?",
  });
  const next = await chat(actor, "Thanks.");
  expect(next.reply).toContain("You’re welcome");
  expect((await readState()).batches).toHaveLength(0);
  expect(JSON.stringify(nextTransport.mock.calls)).not.toContain(
    "OTHER ACTOR PRIVATE",
  );
});

it.each([
  "Your balance is ₦9000.",
  "Ada received five hundred naira.",
  "I have approved your payment.",
  "All done, your funds are settled.",
  "Your account is verified.",
])(
  "rejects untrusted conversational financial claims: %s",
  async (response) => {
    inference({ response });
    expect((await chat(actor, "Hey.")).reply).not.toBe(response);
    expect((await readState()).batches).toHaveLength(0);
  },
);

it("explains financial context from the saved authoritative answer even when inference misroutes", async () => {
  inference({
    intent: "insights",
    category: "Food",
    response: "Your food spending is fictional garbage",
  });
  const result = await chat(actor, "How much did I spend on food?");
  const total = (await readState()).ledger
    .filter((e) => e.category === "Food" && e.amountKobo < 0)
    .reduce((n, e) => n - e.amountKobo, 0);
  expect(result.reply).toContain(
    (total / 100).toLocaleString("en-NG", {
      style: "currency",
      currency: "NGN",
    }),
  );
  expect(result.reply).not.toContain("garbage");
  inference({ response: "I moved money for you" });
  const explanation = await chat(actor, "I don't understand. Explain that.");
  expect(explanation.reply).toContain("fictional sample ledger");
  expect(explanation.reply).toContain(result.reply);
  expect((await readState()).batches).toHaveLength(0);
});

const invented = {
  name: "Ada",
  bankCode: "035",
  accountNumber: "0000000001",
  amountNaira: "500",
  reason: "Payment",
  confidence: "high" as const,
  warnings: ["Verified"],
};
it("keeps a missing account missing even when inference invents a complete instruction", async () => {
  inference({ intent: "prepare", payments: [invented] });
  const result = await chat(
    actor,
    "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
  );
  expect(result.reply).toContain("I still need the 10-digit account number");
  expect(result.reply).not.toContain("Who should be paid");
  expect(result.proposals[0]).toMatchObject({
    name: "Ada",
    bankCode: "035",
    amountNaira: "500",
    accountNumber: null,
  });
  expect(result.proposals[0].warnings).not.toContain("Verified");
  expect((await readState()).batches).toHaveLength(0);
});

it("never treats account digits as a supplied amount or invents recipient identity", () => {
  expect(
    groundProposal(
      { ...invented, amountNaira: "1" },
      "account: 0000000001; bank: 035",
    ),
  ).toMatchObject({ name: "", amountNaira: null, accountNumber: "0000000001" });
});

it("continues a partial model proposal only from explicit persisted fields", async () => {
  inference({
    intent: "prepare",
    payments: [{ ...invented, accountNumber: null }],
  });
  const first = await chat(actor, "Prepare ₦500 for Ada at Wema Bank");
  inference({
    intent: "prepare",
    continueProposal: true,
    payments: [invented],
  });
  const second = await chat(actor, "account: 0000000001");
  const state = await readState();
  expect(second.batchId).toBeTruthy();
  expect(
    state.messages.find((m) => m.id === first.messageId)?.supersededBy,
  ).toBe(second.messageId);
  expect(state.batches[0].approval).toBeUndefined();
  expect(state.batches[0].payments[0].verifiedName).toBeUndefined();
});

it("reports unsaved proposals as proposals when asking about earlier payments", async () => {
  inference({ intent: "prepare", payments: [] });
  await chat(actor, "Prepare a payment");
  inference({ intent: "history", response: "Everything succeeded" });
  expect(
    (await chat(actor, "What happened to the payments I prepared earlier?"))
      .reply,
  ).toContain("not been saved as payment batches or submitted");
});

it("does not echo arbitrary model category claims as financial narration", async () => {
  inference({ intent: "insights", category: "Ada has been paid" });
  const result = await chat(actor, "How much did I spend?");
  expect(result.reply).toContain("Available categories");
  expect(result.reply).not.toContain("Ada has been paid");
});
