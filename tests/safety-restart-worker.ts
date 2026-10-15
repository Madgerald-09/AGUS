import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { mutate, readState } from "../src/lib/db";
import { digest } from "../src/lib/domain";
import {
  approveBatch,
  executeBatch,
  finalizeOTP,
  preparePaymentBatch,
  reconcileBatch,
  reconcileOutstanding,
  verifyBeneficiaries,
  webhook,
} from "../src/lib/payments";
import { FixtureProvider, type PaymentProvider } from "../src/lib/paystack";
const action = process.argv[2];
const fixture = new FixtureProvider();
const actor = "restart-operator";
const logCall = (operation: string) =>
  appendFileSync(process.env.SAFETY_CALL_LOG!, `${operation}\n`);
const api: PaymentProvider = {
  mode: "test",
  banks: () => fixture.banks(),
  resolve: (a, b) => fixture.resolve(a, b),
  recipient: (p) => fixture.recipient(p),
  balance: () => fixture.balance(),
  submit: async (p) => {
    logCall("submit");
    const r = await fixture.submit(p);
    return action.startsWith("otp")
      ? { ...r, data: { ...r.data, status: "otp" } }
      : r;
  },
  verify: (p) => fixture.verify(p),
  finalize: async () => {
    logCall("finalize");
    if (action.endsWith("interrupt")) process.exit(0);
    throw new Error("finalize timeout");
  },
};
if (action.endsWith("write") || action.endsWith("interrupt")) {
  const draft = await preparePaymentBatch(actor, [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 50000,
      reason: "Crash recovery",
    },
  ]);
  const verified = await verifyBeneficiaries(actor, draft.id, api);
  const b = await approveBatch(actor, draft.id, digest(verified));
  await executeBatch(actor, b.id, b.approval!.nonce, api);
  if (action.startsWith("reversal")) {
    await reconcileBatch(actor, b.id, api);
    api.verify = async () => {
      if (action.endsWith("interrupt")) process.exit(0);
      throw new Error("verification timeout");
    };
    const raw = JSON.stringify({
      event: "transfer.reversed",
      data: { reference: b.payments[0].reference },
    });
    await webhook(
      raw,
      createHmac("sha512", "sk_test_fictional").update(raw).digest("hex"),
      api,
    );
    assert.equal((await readState()).batches[0].status, "successful");
  } else {
    await finalizeOTP(actor, b.id, b.payments[0].id, "123456", api);
  }
} else {
  let s = await readState();
  const b = s.batches[0];
  api.submit = async () => {
    throw new Error("Recovery must never submit");
  };
  if (action === "reversal-inspect") {
    assert.equal(b.status, "reversed");
    assert.equal(b.payments[0].providerFeeKobo, 1000);
    assert.ok(s.webhookWork[0].completedAt);
  } else if (action === "otp-inspect") {
    assert.ok(b.payments[0].otpFinalization);
    assert.equal(b.payments[0].status, "unknown");
  } else if (action === "reversal-read") {
    assert.equal(s.webhookWork[0].completedAt, undefined);
    assert.equal(b.status, "successful");
    api.verify = async (p) => {
      const r = await fixture.verify(p);
      return {
        ...r,
        data: { ...r.data, status: "reversed", fee_charged: 1000, fees: 1000 },
      };
    };
    await reconcileOutstanding(api);
    s = await readState();
    assert.equal(s.batches[0].status, "reversed");
    assert.equal(s.batches[0].payments[0].providerFeeKobo, 1000);
    assert.ok(s.webhookWork[0].completedAt);
    assert.equal(s.webhookWork[0].attempts, 2);
    assert.ok(s.audit.some((a) => a.action === "webhook.reconciled"));
  } else {
    assert.ok(b.payments[0].otpFinalization);
    // A new verification after restart still must not reopen OTP finalization.
    api.verify = async (p) => {
      const r = await fixture.verify(p);
      return { ...r, data: { ...r.data, status: "otp" } };
    };
    await reconcileOutstanding(api);
    await assert.rejects(
      finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
    );
    s = await readState();
    assert.equal(s.batches[0].payments[0].status, "unknown");
  }
  // Force another durable write/read cycle, preserving recovery data and audit.
  await mutate(() => undefined);
}
process.exit(0);
