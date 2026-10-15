import { beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mutate, readState } from "../src/lib/db";
import { digest, money, seedState, type Payment } from "../src/lib/domain";
import {
  approveBatch,
  editBatch,
  executeBatch,
  finalizeOTP,
  preparePaymentBatch,
  reconcileBatch,
  reconcileOutstanding,
  verifyBeneficiaries,
  webhook,
} from "../src/lib/payments";
import {
  FixtureProvider,
  Paystack,
  type PaymentProvider,
  type TransferData,
} from "../src/lib/paystack";
import { exportPaymentReport } from "../src/lib/intelligence";

const actor = "safety-operator";
const instruction = {
  name: "Ada",
  bankCode: "035",
  accountNumber: "0000000001",
  amountKobo: 50000,
  reason: "Regression",
};
const fixture = new FixtureProvider();
function offlineProvider(): PaymentProvider {
  return {
    mode: "test",
    banks: () => fixture.banks(),
    resolve: (a, b) => fixture.resolve(a, b),
    recipient: async (p) => {
      const r = await fixture.recipient(p);
      return { ...r, data: { ...r.data, id: 123 } };
    },
    balance: () => fixture.balance(),
    submit: (p) => fixture.submit(p),
    verify: (p) => fixture.verify(p),
    finalize: (p, otp) => fixture.finalize(p, otp),
  };
}
async function submitted(api = offlineProvider(), otp = false) {
  const draft = await preparePaymentBatch(actor, [instruction]);
  const verified = await verifyBeneficiaries(actor, draft.id, api);
  const approved = await approveBatch(actor, draft.id, digest(verified));
  if (otp)
    api.submit = async (p) => {
      const r = await fixture.submit(p);
      return { ...r, data: { ...r.data, status: "otp" } };
    };
  return executeBatch(actor, draft.id, approved.approval!.nonce, api);
}
function signed(reference: string, event = "transfer.reversed") {
  const raw = JSON.stringify({ event, data: { reference } });
  return [
    raw,
    createHmac("sha512", "sk_test_fictional").update(raw).digest("hex"),
  ] as const;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "test";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fictional";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in regression tests");
    }),
  );
  await mutate((s) => Object.assign(s, seedState()));
});

it.each([
  { amountKobo: 100000 },
  { name: "Changed beneficiary" },
  { accountNumber: "0000000002", bankCode: "044" },
  { reason: "Changed reason" },
])(
  "rejects another session's stale acknowledged digest after %j",
  async (patch) => {
    const api = offlineProvider();
    const draft = await preparePaymentBatch(actor, [instruction]);
    const reviewed = await verifyBeneficiaries(actor, draft.id, api);
    const acknowledged = digest(reviewed);
    await editBatch(actor, draft.id, [{ ...instruction, ...patch }]);
    const changed = await verifyBeneficiaries(actor, draft.id, api);
    expect(digest(changed)).not.toBe(acknowledged);
    await expect(approveBatch(actor, draft.id, acknowledged)).rejects.toThrow(
      "changed",
    );
    await expect(
      approveBatch(actor, draft.id, digest(changed)),
    ).resolves.toMatchObject({ status: "approved" });
  },
);

it("keeps a reversal retry durable after timeout, then deduplicates and tolerates out-of-order events", async () => {
  const api = offlineProvider();
  const b = await submitted(api);
  await reconcileBatch(actor, b.id, api);
  const delivery = signed(b.payments[0].reference);
  api.verify = vi.fn(async () => {
    throw new Error("verification timeout");
  });
  api.submit = vi.fn(api.submit);
  api.finalize = vi.fn(api.finalize);
  await webhook(...delivery, api);
  let state = await readState();
  expect(state.batches[0].status).toBe("successful");
  expect(state.webhookIds).toHaveLength(1);
  expect(state.webhookWork[0]).toMatchObject({
    attempts: 1,
    lastError: "verification timeout",
  });
  expect(state.webhookWork[0].completedAt).toBeUndefined();
  // Provider may still report the old success: receiving a response is not completion.
  api.verify = (p) => fixture.verify(p);
  await reconcileOutstanding(api);
  expect((await readState()).webhookWork[0].completedAt).toBeUndefined();
  api.verify = vi.fn(async (p) => {
    const r = await fixture.verify(p);
    return { ...r, data: { ...r.data, status: "reversed" } };
  });
  await Promise.all([
    reconcileOutstanding(api),
    webhook(...delivery, api),
    webhook(...delivery, api),
  ]);
  state = await readState();
  expect(state.batches[0].status).toBe("reversed");
  expect(state.webhookWork).toHaveLength(1);
  expect(state.webhookWork[0].completedAt).toBeTruthy();
  expect(
    state.audit.filter((a) => a.action === "webhook.reconciled"),
  ).toHaveLength(1);
  const attempts = state.webhookWork[0].attempts;
  await webhook(...delivery, api);
  expect((await readState()).webhookWork[0].attempts).toBe(attempts);
  api.verify = (p) => fixture.verify(p);
  await webhook(...signed(b.payments[0].reference, "transfer.success"), api);
  expect((await readState()).batches[0].status).toBe("reversed");
  expect(api.submit).not.toHaveBeenCalled();
  expect(api.finalize).not.toHaveBeenCalled();
});

it("recovers a receipt-only snapshot from the previous implementation without redelivery", async () => {
  const api = offlineProvider();
  const b = await submitted(api);
  await webhook(...signed(b.payments[0].reference, "transfer.success"), api);
  await mutate((s) => {
    s.webhookWork = [];
  });
  await reconcileOutstanding(api);
  expect((await readState()).webhookWork[0].completedAt).toBeTruthy();
});

it("restores consumed OTP claims from the previous implementation's audit trail", async () => {
  const api = offlineProvider();
  const b = await submitted(api, true);
  await finalizeOTP(actor, b.id, b.payments[0].id, "123456", api);
  await mutate((s) => {
    const p = s.batches[0].payments[0];
    delete p.otpFinalization;
    delete p.operationGeneration;
    p.status = "awaiting_otp";
  });
  api.finalize = vi.fn(api.finalize);
  expect((await readState()).batches[0].payments[0]).toMatchObject({
    status: "unknown",
    otpFinalization: { outcome: "uncertain" },
  });
  await expect(
    finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
  ).rejects.toThrow();
  expect(api.finalize).not.toHaveBeenCalled();
});

it.each(["otp", "timeout"])(
  "ignores delayed %s verification after a concurrent one-use OTP claim",
  async (response) => {
    const api = offlineProvider();
    const b = await submitted(api, true);
    const entered = deferred<void>();
    const release = deferred<void>();
    api.verify = async (p) => {
      entered.resolve();
      await release.promise;
      if (response === "timeout") throw new Error("old timeout");
      const r = await fixture.verify(p);
      return { ...r, data: { ...r.data, status: "otp" } };
    };
    const delayed = reconcileBatch(actor, b.id, api);
    await entered.promise;
    api.finalize = vi.fn(async (p) => fixture.submit(p));
    const results = await Promise.allSettled([
      finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
      finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    release.resolve();
    await delayed;
    expect((await readState()).batches[0].payments[0]).toMatchObject({
      status: "processing",
      operationGeneration: 2,
      otpFinalization: { outcome: "recorded" },
    });
    await expect(
      finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
    ).rejects.toThrow();
    expect(api.finalize).toHaveBeenCalledTimes(1);
    // Even a fresh provider otp response cannot reopen a consumed claim.
    api.verify = async (p) => {
      const r = await fixture.verify(p);
      return { ...r, data: { ...r.data, status: "otp" } };
    };
    expect((await reconcileBatch(actor, b.id, api)).status).toBe("unknown");
    await expect(
      finalizeOTP(actor, b.id, b.payments[0].id, "123456", api),
    ).rejects.toThrow();
    expect(api.finalize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await readState())).not.toContain("123456");
  },
);

it("retains an uncertain OTP claim without automatic or manual resubmission", async () => {
  const api = offlineProvider();
  const b = await submitted(api, true);
  api.finalize = vi.fn(async () => {
    throw new Error("finalization timeout");
  });
  expect(
    (await finalizeOTP(actor, b.id, b.payments[0].id, "654321", api)).status,
  ).toBe("unknown");
  await expect(
    finalizeOTP(actor, b.id, b.payments[0].id, "654321", api),
  ).rejects.toThrow();
  await reconcileOutstanding(api);
  expect(api.finalize).toHaveBeenCalledTimes(1);
  expect(
    (await readState()).batches[0].payments[0].otpFinalization?.outcome,
  ).toBe("uncertain");
});

it("normalizes documented fee_charged in kobo, persists it, and exports the exact confirmed charge", async () => {
  const api = offlineProvider();
  const b = await submitted(api);
  const transport = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: b.payments[0].reference,
            amount: 50000,
            currency: "NGN",
            domain: "test",
            status: "success",
            recipient: b.payments[0].recipientCode,
            fee_charged: 1000,
          },
        }),
      ),
  );
  const paystack = new Paystack("test", "sk_test_fictional", transport);
  const confirmed = await reconcileBatch(actor, b.id, paystack);
  expect(confirmed.payments[0].providerFeeKobo).toBe(1000);
  const state = await readState();
  expect(state.batches[0].payments[0].providerFeeKobo).toBe(1000);
  expect(state.batches[0].feeReserveKobo).toBe(5000);
  expect(money(confirmed.payments[0].providerFeeKobo!)).toMatch(/10\.00/);
  const csv = exportPaymentReport(state, actor).split("\r\n");
  const headers = csv[0].split(",");
  const row = csv[1].split(",");
  expect(row[headers.indexOf('"confirmed_fee_kobo"')]).toBe('"1000"');
  expect(row[headers.indexOf('"fee_reserve_kobo"')]).toBe('"5000"');
});

it.each([-1, 1.5, "1000", null, Number.MAX_SAFE_INTEGER + 1])(
  "rejects malformed fee_charged %j",
  async (fee) => {
    const b = await submitted();
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: true,
            data: {
              reference: b.payments[0].reference,
              amount: 50000,
              currency: "NGN",
              status: "success",
              fee_charged: fee,
            },
          }),
        ),
    );
    await expect(
      new Paystack("test", "sk_test_fictional", transport).verify(
        b.payments[0],
      ),
    ).rejects.toThrow();
  },
);

it("accepts legacy fees and rejects conflicting confirmed fee evidence", async () => {
  const api = offlineProvider();
  const b = await submitted(api);
  api.verify = async (p) => {
    const r = await fixture.verify(p);
    return { ...r, data: { ...r.data, fees: 1000 } };
  };
  expect(
    (await reconcileBatch(actor, b.id, api)).payments[0].providerFeeKobo,
  ).toBe(1000);
  const other = await submitted(api);
  api.verify = async (p) => {
    const r = await fixture.verify(p);
    return { ...r, data: { ...r.data, fee_charged: 1000, fees: 2000 } };
  };
  expect((await reconcileBatch(actor, other.id, api)).status).toBe("unknown");
});

const recipientCases: {
  name: string;
  recipient: (p: Payment) => TransferData["recipient"];
  expected: string;
}[] = [
  {
    name: "matching string",
    recipient: (p) => p.recipientCode,
    expected: "successful",
  },
  {
    name: "matching object",
    recipient: (p) => ({
      recipient_code: p.recipientCode,
      id: 123,
      details: { account_number: p.accountNumber, bank_code: p.bankCode },
    }),
    expected: "successful",
  },
  { name: "matching numeric ID", recipient: () => 123, expected: "successful" },
  {
    name: "matching account and bank",
    recipient: (p) => ({
      details: { account_number: p.accountNumber, bank_code: p.bankCode },
    }),
    expected: "successful",
  },
  {
    name: "wrong string",
    recipient: () => "RCP_WRONG_RECIPIENT",
    expected: "unknown",
  },
  {
    name: "wrong object code",
    recipient: () => ({ recipient_code: "RCP_WRONG_RECIPIENT" }),
    expected: "unknown",
  },
  {
    name: "conflicting account",
    recipient: (p) => ({
      recipient_code: p.recipientCode,
      details: { account_number: "9999999999" },
    }),
    expected: "unknown",
  },
  {
    name: "conflicting bank",
    recipient: (p) => ({
      recipient_code: p.recipientCode,
      details: { bank_code: "999" },
    }),
    expected: "unknown",
  },
  {
    name: "conflicting ID",
    recipient: (p) => ({ recipient_code: p.recipientCode, id: 999 }),
    expected: "unknown",
  },
  { name: "missing identity", recipient: () => undefined, expected: "unknown" },
  { name: "empty object", recipient: () => ({}), expected: "unknown" },
  { name: "malformed code", recipient: () => "", expected: "unknown" },
];
it("keeps numeric recipient evidence unknown when no approved recipient ID was stored", async () => {
  const api = offlineProvider();
  api.recipient = (p) => fixture.recipient(p);
  const b = await submitted(api);
  api.verify = async (p) => {
    const r = await fixture.verify(p);
    return { ...r, data: { ...r.data, recipient: 123 } };
  };
  expect((await reconcileBatch(actor, b.id, api)).status).toBe("unknown");
});
it.each(recipientCases)(
  "validates recipient evidence: $name",
  async ({ recipient, expected }) => {
    const api = offlineProvider();
    const b = await submitted(api);
    const r = await fixture.verify(b.payments[0]);
    const data = { ...r.data, recipient: recipient(b.payments[0]) };
    const transport = vi.fn(
      async () => new Response(JSON.stringify({ status: true, data })),
    );
    const result = await reconcileBatch(
      actor,
      b.id,
      new Paystack("test", "sk_test_fictional", transport),
    );
    expect(result.status).toBe(expected);
    expect(result.payments[0].responses.at(-1)?.operation).toBe("verify");
  },
);
