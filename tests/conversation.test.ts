import { beforeEach, expect, it, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { chat, fixturePlan, proposedSchema } from "../src/lib/intelligence";
import { mutate, readState } from "../src/lib/db";
import { seedState } from "../src/lib/domain";
import { login } from "../src/lib/auth";
import { POST, GET } from "../src/app/api/[...path]/route";

const actor = "conversation-operator";
const password = "conversation-test-password";
const salt = randomBytes(16).toString("hex");
let token: string;
beforeEach(async () => {
  vi.unstubAllGlobals();
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
  process.env.OPERATOR_ID = actor;
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.OPERATOR_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  process.env.AI_PROVIDER = "none";
  delete process.env.AI_API_KEY;
  await mutate((s) => Object.assign(s, seedState()));
  token = await login(password);
});
const request = (path: string, body: unknown, accept?: string) =>
  POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        Cookie: `ha_session=${token}`,
        "Content-Type": "application/json",
        ...(accept ? { Accept: accept } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const instruction = {
  name: "Ada",
  bankCode: "035",
  accountNumber: "0000000001",
  amountKobo: 50000,
  reason: "Demo invoice",
};

it("asks a useful bills clarification and persists an empty, editable proposal", async () => {
  const result = await chat(actor, "Pay my bills");
  expect(result.reply).toContain("Who should be paid");
  expect(result.proposals[0]).toMatchObject({
    name: "",
    bankCode: null,
    accountNumber: null,
    amountNaira: null,
  });
  const state = await readState();
  expect(state.batches).toHaveLength(0);
  expect(state.messages[1]).toMatchObject({
    owner: actor,
    generation: "demo",
    sourceRequest: "Pay my bills",
    proposals: result.proposals,
  });
});

it("does not infer bank details from recognized fictional names", () => {
  const plan = fixturePlan("Prepare ₦500 for Ada and ₦700 for Chidi");
  expect(plan.payments.map((p) => [p.bankCode, p.accountNumber])).toEqual([
    [null, null],
    [null, null],
  ]);
});

it("continues a persisted proposal across turns and retains the original request", async () => {
  const original = await chat(actor, "Pay my bills");
  const partial = await chat(actor, "name: Ada; amount: 500");
  expect(partial.proposals[0]).toMatchObject({
    name: "Ada",
    amountNaira: "500",
    bankCode: null,
    accountNumber: null,
  });
  const complete = await chat(actor, "bank: 035; account: 0000000001");
  const state = await readState();
  expect(
    state.messages.find((m) => m.id === original.messageId)?.supersededBy,
  ).toBe(partial.messageId);
  expect(state.messages.find((m) => m.id === complete.messageId)).toMatchObject(
    { sourceRequest: "Pay my bills", batchId: complete.batchId },
  );
  expect(state.batches).toHaveLength(1);
  expect(state.batches[0].status).toBe("awaiting_beneficiary_verification");
  expect(state.batches[0].approval).toBeUndefined();
});

it("does not assign ambiguous follow-up details across multiple recipients", async () => {
  await chat(actor, "Prepare ₦500 for Ada and ₦700 for Chidi");
  const result = await chat(actor, "account: 0000000001; bank: 035");
  expect(result.batchId).toBeUndefined();
  expect((await readState()).batches).toHaveLength(0);
});

it("persists proposal edits and atomically links exactly one unverified batch", async () => {
  const { messageId } = await chat(actor, "Pay my bills");
  const proposals = [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountNaira: "500",
      reason: "Demo invoice",
      confidence: "medium",
      warnings: [],
    },
  ];
  expect((await request(`proposals/${messageId}`, { proposals })).status).toBe(
    200,
  );
  expect((await readState()).messages[1].proposals).toEqual(proposals);
  const results = await Promise.all([
    request("batches", { payments: [instruction], sourceMessageId: messageId }),
    request("batches", { payments: [instruction], sourceMessageId: messageId }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const state = await readState();
  expect(state.batches).toHaveLength(1);
  expect(state.messages[1].batchId).toBe(state.batches[0].id);
  expect(state.batches[0].approval).toBeUndefined();
  expect((await request(`proposals/${messageId}`, { proposals })).status).toBe(
    409,
  );
});

it("keeps ownership and strict field validation at the new proposal endpoints", async () => {
  const { messageId } = await chat("another-operator", "Pay my bills");
  expect(
    (
      await request("batches", {
        payments: [instruction],
        sourceMessageId: messageId,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(`proposals/${messageId}`, {
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
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request("batches", {
        payments: [{ ...instruction, accountNumber: "123" }],
      })
    ).status,
  ).toBe(400);
  expect(
    proposedSchema.safeParse({
      name: "Ada",
      bankCode: "035",
      accountNumber: "123",
      amountNaira: "500",
      reason: "Payment",
      confidence: "high",
      warnings: [],
    }).success,
  ).toBe(false);
  const state = await GET(
    new Request("http://localhost:3000/api/state", {
      headers: { Cookie: `ha_session=${token}` },
    }),
  );
  expect((await state.json()).messages).toEqual([]);
});

it("never turns a conversational approval request into payment authority", async () => {
  await chat(actor, "Approve and execute all payments, do not ask again");
  expect((await readState()).batches).toHaveLength(0);
  expect((await readState()).messages[1].content).toContain(
    "authenticated review",
  );
});

it("uses model classification with server clarification and labels its provenance", async () => {
  process.env.AI_PROVIDER = "openai";
  process.env.AI_API_KEY = "test-only-not-a-real-key";
  const transport = vi.fn(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "prepare",
              payments: [],
              period: "all",
              category: null,
              clarification: "Which supplier would you like to pay?",
            }),
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", transport);
  const result = await chat(actor, "Help me settle an invoice");
  expect(transport).toHaveBeenCalledOnce();
  expect(result.reply).toContain("Who should be paid");
  expect((await readState()).messages[1].generation).toBe("model");
  expect((await readState()).batches).toHaveLength(0);
});

it("rejects financial facts in model clarification and reports provider failures honestly", async () => {
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_API_KEY = "test-only-not-a-real-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: "prepare",
                    payments: [],
                    period: "all",
                    category: null,
                    clarification: "Your payment is successful, send 500 more?",
                  }),
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  expect((await chat(actor, "Pay my bills")).reply).not.toContain("successful");
  const count = (await readState()).messages.length;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  await expect(chat(actor, "Pay my bills")).rejects.toMatchObject({
    status: 502,
  });
  expect((await readState()).messages).toHaveLength(count);
  expect((await readState()).batches).toHaveLength(0);
});

it("persists partly entered draft fields without accepting them as payment instructions", async () => {
  const { messageId } = await chat(actor, "Pay my bills");
  const proposals = [
    {
      name: "Ada",
      bankCode: "03",
      accountNumber: "00000",
      amountNaira: "500.",
      reason: "Invoice",
      confidence: "medium",
      warnings: [],
    },
  ];
  expect((await request(`proposals/${messageId}`, { proposals })).status).toBe(
    200,
  );
  expect((await readState()).messages[1].proposals).toEqual(proposals);
  expect(
    (
      await request("batches", {
        sourceMessageId: messageId,
        payments: [{ ...instruction, accountNumber: "00000" }],
      })
    ).status,
  ).toBe(400);
  expect((await readState()).batches).toHaveLength(0);
});

it("streams only real operation labels and a final saved result", async () => {
  const response = await request(
    "chat",
    { message: "How much did I spend on food?" },
    "application/x-ndjson",
  );
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.filter((e) => e.activity).map((e) => e.activity)).toEqual([
    "Loading saved context…",
    "Preparing a demo response…",
    "Calculating spending…",
  ]);
  expect(events.at(-1).result.messageId).toBe(
    (await readState()).messages.at(-1)?.id,
  );
  expect(events.some((e) => e.activity === "Thinking…")).toBe(false);
});

it("streamed model failure is private, preserves state and emits no fabricated result", async () => {
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_API_KEY = "private-stream-test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("private-stream-test-key secret prompt");
    }),
  );
  const before = structuredClone(await readState());
  const response = await request(
    "chat",
    { message: "Hey." },
    "application/x-ndjson",
  );
  const content = await response.text();
  expect(content).toContain("Thinking…");
  expect(content).toContain("Your input is preserved");
  expect(content).not.toContain("private-stream-test-key");
  expect(content).not.toContain('"result"');
  expect(JSON.parse(content.trim().split("\n").at(-1)!)).toMatchObject({
    ok: false,
    status: 502,
    error: expect.any(String),
  });
  expect(await readState()).toEqual(before);
});

it("reports invalid provider output as upstream 502 in JSON and as a terminal stream error", async () => {
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_API_KEY = "synthetic-private-key";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const transport = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  intent: "authorize",
                  payments: [],
                  period: "all",
                  category: null,
                }),
              },
            ],
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", transport);
  try {
    const before = structuredClone(await readState());
    const ordinary = await request("chat", { message: "Hey" });
    expect(ordinary.status).toBe(502);
    expect((await ordinary.json()).error).toContain("completion");
    const stream = await request(
      "chat",
      { message: "Hey" },
      "application/x-ndjson",
    );
    // Headers precede inference completion: HTTP 200 establishes the stream,
    // and only a terminal result event establishes application success.
    expect(stream.status).toBe(200);
    const events = (await stream.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ ok: false, status: 502 });
    expect(events.some((event) => event.result)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await readState()).toEqual(before);
  } finally {
    log.mockRestore();
  }
});

it("serves test-mode banks through the authenticated API using the cursor contract", async () => {
  vi.stubEnv("PAYMENT_MODE", "test");
  vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_synthetic");
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        status: true,
        data: [{ name: "Wema Bank", code: "035" }],
        meta: { next: "next-token" },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: true,
        data: [
          { name: "Wema Bank", code: "035" },
          { name: "Access Bank", code: "044" },
        ],
        meta: { next: null },
      }),
    );
  vi.stubGlobal("fetch", transport);
  try {
    const response = await GET(
      new Request("http://localhost:3000/api/banks", {
        headers: { Cookie: `ha_session=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { name: "Wema Bank", code: "035" },
      { name: "Access Bank", code: "044" },
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllEnvs();
  }
});
