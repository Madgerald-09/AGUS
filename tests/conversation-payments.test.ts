import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mutate, readState } from "../src/lib/db";
import { seedState, digest } from "../src/lib/domain";
import { chatHistory } from "../src/lib/chat-history/store";
import {
  conversationPayment,
  rememberConversationPayment,
} from "../src/lib/conversation-payment";
import { extractConversationPayment } from "../src/lib/intelligence";
import { POST } from "../src/app/api/conversation/payment-draft/route";
import { login } from "../src/lib/auth";
import {
  preparePaymentBatch,
  verifyBeneficiaries,
  approveBatch,
  executeBatch,
  reconcileBatch,
} from "../src/lib/payments";
import { FixtureProvider } from "../src/lib/paystack";
vi.mock("../src/lib/intelligence", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractConversationPayment: vi.fn(),
}));
const owner = "fictional-chat-payment-operator";
const origin = "http://localhost:3000";
const proposals = [
  {
    name: "Ada",
    bankCode: "035",
    accountNumber: "0000000001",
    amountNaira: "500",
    reason: "Fictional lunch",
    confidence: "high" as const,
    warnings: [],
  },
  {
    name: "Chidi",
    bankCode: "044",
    accountNumber: "0000000002",
    amountNaira: "600",
    reason: "Fictional books",
    confidence: "high" as const,
    warnings: [],
  },
];
let token: string;
beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    PAYMENT_MODE: "fixture",
    FINANCIAL_DEMO_ENABLED: "true",
    OPERATOR_ID: owner,
    APP_ORIGIN: origin,
  });
  const password = randomBytes(24).toString("hex"),
    salt = randomBytes(16).toString("hex");
  process.env.OPERATOR_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  token = await login(password);
});
beforeEach(async () => {
  vi.mocked(extractConversationPayment)
    .mockReset()
    .mockResolvedValue(proposals);
  await mutate((s) => Object.assign(s, seedState()));
});
afterEach(() => vi.restoreAllMocks());
async function savedTurn(handoff = true) {
  const chat = randomUUID(),
    history = chatHistory(owner);
  const text =
    "Prepare 500 to Ada at Wema account 0000000001 and 600 to Chidi at Access account 0000000002";
  const lease = await history.claim(chat, text);
  const turn = await history.finish(chat, lease, text, {
    kind: handoff ? "handoff" : "general",
    text: "Review a payment draft.",
    citations: [],
    evidence: { modelCalls: 0, toolCalls: 0, resultBytes: 0 },
    ...(handoff
      ? { handoff: { kind: "existing_payment_draft" as const } }
      : {}),
  });
  return { chat, turn };
}
function request(
  chat: string,
  turn: string,
  cookie = token,
  requestOrigin = origin,
  extra = {},
) {
  return new Request(`${origin}/api/conversation/payment-draft`, {
    method: "POST",
    headers: {
      cookie: `ha_session=${cookie}`,
      origin: requestOrigin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ conversationId: chat, turnId: turn, ...extra }),
  });
}
it("binds draft preparation to an owned saved handoff and rejects identity injection", async () => {
  const { chat, turn } = await savedTurn();
  expect((await POST(request(chat, turn.id, ""))).status).toBe(401);
  expect(
    (await POST(request(chat, turn.id, token, "https://evil.invalid"))).status,
  ).toBe(403);
  expect(
    (await POST(request(chat, turn.id, token, origin, { owner: "other" })))
      .status,
  ).toBe(400);
  expect((await POST(request(chat, randomUUID()))).status).toBe(404);
  await expect(
    conversationPayment("other-owner", chat, turn.id),
  ).rejects.toMatchObject({ status: 404 });
  const ordinary = await savedTurn(false);
  expect((await POST(request(ordinary.chat, ordinary.turn.id))).status).toBe(
    404,
  );
  expect(extractConversationPayment).not.toHaveBeenCalled();
});
it("commits one editable proposal before inference and recovers concurrent/repeated requests", async () => {
  const { chat, turn } = await savedTurn();
  const results = await Promise.all([
    conversationPayment(owner, chat, turn.id),
    conversationPayment(owner, chat, turn.id),
  ]);
  expect(results.map((r) => r.id)).toEqual([turn.id, turn.id]);
  expect(extractConversationPayment).toHaveBeenCalledTimes(1);
  const restored = await conversationPayment(owner, chat, turn.id);
  expect(restored).toMatchObject({
    conversationId: chat,
    turnId: turn.id,
    proposals,
  });
  expect((await readState()).batches).toHaveLength(0);
  expect((await readState()).messages).toHaveLength(1);
});
it("retains an owner-bound payment source while the displayed transcript stays redacted", async () => {
  const { chat, turn } = await savedTurn();
  expect(turn.text).not.toContain("0000000001");
  const original = "Prepare 500 to Ada at Wema account 0000000001";
  await rememberConversationPayment(owner, chat, turn.id, original);
  const message = await conversationPayment(owner, chat, turn.id);
  expect(extractConversationPayment).toHaveBeenCalledWith(original);
  expect(message).toMatchObject({
    conversationId: chat,
    turnId: turn.id,
    sourceRequest: original,
  });
  await rememberConversationPayment(
    owner,
    chat,
    turn.id,
    "Must not replace the stored source",
  );
  expect((await conversationPayment(owner, chat, turn.id)).sourceRequest).toBe(
    original,
  );
});
it("keeps a manually recoverable draft after failed extraction without repeating model calls", async () => {
  vi.mocked(extractConversationPayment).mockRejectedValue(
    new Error("mock unavailable"),
  );
  const { chat, turn } = await savedTurn();
  const message = await conversationPayment(owner, chat, turn.id);
  expect(message.proposals?.[0].accountNumber).toBeNull();
  expect((await conversationPayment(owner, chat, turn.id)).id).toBe(message.id);
  expect(extractConversationPayment).toHaveBeenCalledTimes(1);
});
it("does not overwrite manual edits made while extraction is pending", async () => {
  let resolve!: (p: typeof proposals) => void;
  const entered = new Promise<void>((done) =>
    vi.mocked(extractConversationPayment).mockImplementation(() => {
      done();
      return new Promise((r) => {
        resolve = r;
      });
    }),
  );
  const { chat, turn } = await savedTurn();
  const pending = conversationPayment(owner, chat, turn.id);
  await entered;
  await mutate((s) => {
    s.messages.find((m) => m.id === turn.id)!.proposals![0].name =
      "Manually edited";
  });
  resolve(proposals);
  expect((await pending).proposals?.[0].name).toBe("Manually edited");
});
it("preserves multi-recipient state through approval, interrupted submission, unknown reconciliation and recovery", async () => {
  const { chat, turn } = await savedTurn();
  const message = await conversationPayment(owner, chat, turn.id);
  const instructions = proposals.map((p) => ({
    name: p.name,
    bankCode: p.bankCode,
    accountNumber: p.accountNumber,
    amountKobo: Number(p.amountNaira) * 100,
    reason: p.reason,
  }));
  const batch = await preparePaymentBatch(owner, instructions, message.id);
  await expect(
    preparePaymentBatch(owner, instructions, message.id),
  ).rejects.toMatchObject({ status: 409 });
  const fixture = new FixtureProvider();
  const submit = vi
    .spyOn(fixture, "submit")
    .mockRejectedValue(new Error("Fixture timeout, unknown outcome"));
  const verify = vi
    .spyOn(fixture, "verify")
    .mockRejectedValue(new Error("Fixture verify unavailable"));
  const reviewed = await verifyBeneficiaries(owner, batch.id, fixture);
  const approved = await approveBatch(owner, batch.id, digest(reviewed));
  await executeBatch(owner, batch.id, approved.approval!.nonce, fixture);
  const state = await readState();
  expect(state.batches[0].payments).toHaveLength(2);
  expect(state.batches[0].approval?.consumedAt).toBeTruthy();
  expect(state.batches[0].payments.every((p) => p.status === "unknown")).toBe(
    true,
  );
  const refs = state.batches[0].payments.map((p) => p.reference);
  await expect(
    executeBatch(owner, batch.id, approved.approval!.nonce, fixture),
  ).rejects.toBeTruthy();
  await reconcileBatch(owner, batch.id, fixture);
  expect(submit).toHaveBeenCalledTimes(2);
  verify.mockRestore();
  await reconcileBatch(owner, batch.id, fixture);
  const recovered = (await readState()).batches[0];
  expect(recovered.payments.map((p) => p.reference)).toEqual(refs);
  expect(recovered.payments.map((p) => p.status)).toEqual([
    "successful",
    "processing",
  ]);
  expect((await conversationPayment(owner, chat, turn.id)).batchId).toBe(
    batch.id,
  );
  expect(extractConversationPayment).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(2);
});
