import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chat } from "../src/lib/intelligence";
import { composeConversation } from "../src/lib/conversation-policy";
import { mutate, readState } from "../src/lib/db";
import { digest, seedState } from "../src/lib/domain";
import {
  approveBatch,
  editBatch,
  preparePaymentBatch,
  verifyBeneficiaries,
} from "../src/lib/payments";
import { FixtureProvider, fixtureBanks } from "../src/lib/paystack";

const actor = "demo-polish";
const instruction = {
  name: "Ada",
  bankCode: "035",
  accountNumber: "0000000001",
  amountKobo: 50000,
  reason: "Invoice",
};
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("AI_PROVIDER", "none");
  vi.stubEnv("AI_API_KEY", "");
  await mutate((s) => Object.assign(s, seedState()));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(["Hi Agus", "Hello, Agus!", "Hey Agus", "Good morning Agus"])(
  "greets naturally: %s",
  async (text) => {
    const result = await chat(actor, text);
    expect(result.reply).toContain("I’m Agus");
    expect(result.reply).not.toContain("verification");
    expect((await readState()).batches).toHaveLength(0);
  },
);
it("answers capability questions and casual conversation without a payment-status lecture", () => {
  expect(composeConversation("What can you do?")).toContain(
    "prepare payment drafts",
  );
  expect(composeConversation("How are you Agus?")).toContain("ready to help");
  expect(composeConversation("Thanks, Agus!")).toContain("You’re welcome");
  expect(composeConversation("Did that go through?")).toContain(
    "saved payment records",
  );
});
it.each(["Use OPay instead.", "OPay bank naw."])(
  "corrects the institution using the provider list, separately from recipient identity: %s",
  async (correction) => {
    vi.spyOn(FixtureProvider.prototype, "banks").mockResolvedValue([
      ...fixtureBanks,
      { name: "OPay Digital Services Limited (OPay)", code: "999992" },
    ]);
    const first = await chat(actor, "Help me send ₦500 to my Wema account.");
    expect(first.proposals[0]).toMatchObject({
      name: "My account",
      bankCode: "035",
      amountNaira: "500",
      accountNumber: null,
    });
    const edited = await chat(actor, correction);
    expect(edited.proposals[0]).toMatchObject({
      name: "My account",
      bankCode: "999992",
      amountNaira: "500",
      accountNumber: null,
    });
    expect(edited.reply).toContain("selected institution");
    const state = await readState();
    expect(state.batches).toHaveLength(0);
    expect(
      state.messages.find((m) => m.id === first.messageId)?.supersededBy,
    ).toBe(edited.messageId);
  },
);
it("leaves an unavailable institution unchanged instead of fabricating a bank code", async () => {
  await chat(actor, "Help me send ₦500 to my Wema account.");
  const before = (await readState()).messages[1].proposals;
  const reply = await chat(actor, "Use OPay instead.");
  expect(reply.reply).toContain("isn’t in the available bank list");
  expect((await readState()).messages[1].proposals).toEqual(before);
});
it("fails closed when provider bank loading fails", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  vi.spyOn(FixtureProvider.prototype, "banks").mockRejectedValue(
    new Error("provider offline"),
  );
  const reply = await chat(actor, "Change the bank to Wema.");
  expect(reply.reply).toContain("haven’t changed the draft");
  expect((await readState()).batches).toEqual([b]);
});
it("invalidates beneficiary identity, approval and digest when a saved draft bank changes", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  const verified = await verifyBeneficiaries(actor, b.id);
  const approved = await approveBatch(actor, b.id, digest(verified));
  const result = await chat(actor, "Change the bank to Access.");
  const state = await readState();
  expect(result.batchId).toBe(b.id);
  expect(state.batches).toHaveLength(1);
  expect(state.batches[0]).toMatchObject({
    status: "awaiting_beneficiary_verification",
    version: approved.version + 1,
  });
  expect(state.batches[0].approval).toBeUndefined();
  expect(state.batches[0].payments[0]).toMatchObject({
    name: "Ada",
    bankCode: "044",
    accountNumber: "0000000001",
    amountKobo: 50000,
  });
  expect(state.batches[0].payments[0].verifiedName).toBeUndefined();
  expect(state.batches[0].payments[0].recipientCode).toBeUndefined();
  expect(digest(state.batches[0])).not.toBe(digest(approved));
});
it("edits the existing saved amount without creating or submitting a second batch", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  await chat(actor, "Make it ₦700.");
  const state = await readState();
  expect(state.batches).toHaveLength(1);
  expect(state.batches[0].id).toBe(b.id);
  expect(state.batches[0].payments[0].amountKobo).toBe(70000);
  expect(state.batches[0].approval).toBeUndefined();
});
it("asks for a recipient before applying an ambiguous change, then remembers explicit selection", async () => {
  await chat(actor, "Prepare ₦500 for Ada and ₦700 for Chidi");
  const ambiguous = await chat(actor, "Use Wema instead.");
  expect(ambiguous.reply).toContain("Which recipient");
  expect(ambiguous.proposals).toEqual([]);
  const selected = await chat(actor, "I meant the second recipient.");
  expect(selected.reply).toContain("recipient 2: Chidi");
  const edited = await chat(actor, "Change the bank to Wema.");
  expect(edited.proposals.map((p) => p.bankCode)).toEqual([null, "035"]);
  expect(edited.proposals.map((p) => p.name)).toEqual(["Ada", "Chidi"]);
});
it("asks for an account number and never invents it", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  const asked = await chat(actor, "Change the account number.");
  expect(asked.reply).toContain("What 10-digit account number");
  expect((await readState()).batches).toEqual([b]);
  await chat(actor, "account: 0000000002");
  expect((await readState()).batches[0].payments[0].accountNumber).toBe(
    "0000000002",
  );
});
it("does not pick an arbitrary draft or another actor’s draft", async () => {
  await preparePaymentBatch("someone-else", [instruction]);
  const b = await preparePaymentBatch(actor, [instruction]);
  const second = await preparePaymentBatch(actor, [
    { ...instruction, name: "Chidi" },
  ]);
  const result = await chat(actor, "Make it ₦700.");
  expect(result.reply).toContain("Which draft");
  expect((await readState()).batches.filter((x) => x.owner === actor)).toEqual([
    second,
    b,
  ]);
});
it("never edits submitted or unresolved instructions", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  await mutate((s) => {
    s.batches[0].payments[0].status = "unknown";
    s.batches[0].status = "unknown";
  });
  const before = (await readState()).batches;
  expect((await chat(actor, "Make it ₦700.")).reply).toContain(
    "can’t be changed",
  );
  expect((await readState()).batches).toEqual(before);
  expect((await readState()).batches[0].id).toBe(b.id);
});
it("rejects stale conversational edit versions", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  await editBatch(
    actor,
    b.id,
    [{ ...instruction, amountKobo: 70000 }],
    b.version,
  );
  await expect(
    editBatch(actor, b.id, [instruction], b.version),
  ).rejects.toThrow("draft changed");
});

it("asks for an exact label instead of guessing an unknown recipient", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  expect(
    (await chat(actor, "Change the bank for Someone Else to Access.")).reply,
  ).toContain("Which draft");
  expect((await readState()).batches).toEqual([b]);
});
it("rejects malformed amount corrections without changing or creating drafts", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  expect((await chat(actor, "Make it ₦700.999")).reply).toContain(
    "What amount",
  );
  expect((await readState()).batches).toEqual([b]);
});
it("applies deterministic corrections even when inference is unavailable", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_API_KEY", "mock-only");
  const transport = vi.fn().mockRejectedValue(new Error("model unavailable"));
  vi.stubGlobal("fetch", transport);
  try {
    await chat(actor, "Change the bank to Access.");
    expect(transport).not.toHaveBeenCalled();
    expect((await readState()).batches[0].id).toBe(b.id);
    expect((await readState()).batches[0].payments[0].bankCode).toBe("044");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not carry legacy model claims into edited proposal warnings", async () => {
  await chat(actor, "Prepare ₦500 for Ada and ₦700 for Chidi");
  await mutate((s) => {
    s.messages[1].compositionVersion = undefined;
    s.messages[1].proposals!.forEach((p) => {
      p.warnings = ["Untrusted claim that a transfer succeeded"];
    });
  });
  await chat(actor, "I meant the second recipient.");
  const edited = await chat(actor, "Change the bank to Wema.");
  expect(JSON.stringify(edited.proposals)).not.toContain("transfer succeeded");
});

it("keeps the institution’s own name separate from recipient targeting", async () => {
  await preparePaymentBatch(actor, [instruction]);
  await chat(actor, "Change the bank to United Bank for Africa.");
  expect((await readState()).batches[0].payments[0].bankCode).toBe("033");
});
it("does not reinterpret a clear new payment request as a saved-draft correction", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  await chat(actor, "Can you send ₦700 to Chidi; account: 0000000002");
  expect((await readState()).batches[0]).toEqual(b);
});
it("selects a draft by its exact recipient label after a clarification", async () => {
  const b = await preparePaymentBatch(actor, [instruction]);
  await preparePaymentBatch(actor, [{ ...instruction, name: "Chidi" }]);
  await chat(actor, "Make it ₦700.");
  await chat(actor, "I meant Ada.");
  await chat(actor, "Make it ₦700.");
  expect(
    (await readState()).batches.find((x) => x.id === b.id)?.payments[0]
      .amountKobo,
  ).toBe(70000);
});

it("explains an ordinary conversation without switching to a transfer-status lecture", async () => {
  await chat(actor, "Hi Agus");
  const explained = await chat(actor, "What does that mean?");
  expect(explained.reply).toContain("in your own words");
  expect(explained.reply).not.toContain("reconcile");
  expect((await readState()).batches).toHaveLength(0);
});
