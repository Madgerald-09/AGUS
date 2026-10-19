import { expect, it } from "vitest";
import { executionRecoveryPending } from "../src/components/payment-recovery";
import type { PaymentSnapshot } from "../src/components/payment-ui";
const attempt = { batchId: "batch", attemptId: "current" };
const snapshot = (
  status: string,
  consumedAt?: string,
  receipts: { batchId: string; attemptId: string }[] = [],
) =>
  ({
    batches: [{ id: "batch", status, approval: { consumedAt } }],
    executionRejections: receipts,
  }) as PaymentSnapshot;
it("keeps an unclaimed lost response blocked, including repeated recovery", () => {
  for (let i = 0; i < 3; i++)
    expect(executionRecoveryPending(attempt, snapshot("approved"))).toBe(true);
});
it("releases only an exact persisted rejection", () => {
  expect(
    executionRecoveryPending(
      attempt,
      snapshot("approved", undefined, [attempt]),
    ),
  ).toBe(false);
  expect(
    executionRecoveryPending(
      attempt,
      snapshot("approved", undefined, [{ ...attempt, attemptId: "stale" }]),
    ),
  ).toBe(true);
  expect(
    executionRecoveryPending(
      attempt,
      snapshot("approved", undefined, [
        { ...attempt, batchId: "other-owner-batch" },
      ]),
    ),
  ).toBe(true);
});
it.each([
  "submitted",
  "processing",
  "unknown",
  "awaiting_otp",
  "successful",
  "failed",
  "reversed",
])(
  "recognizes a one-use claim for %s; batch controls govern the next action",
  (status) => {
    expect(
      executionRecoveryPending(
        attempt,
        snapshot(status, "2026-10-19T12:00:00Z"),
      ),
    ).toBe(false);
  },
);
it("fails closed on missing or legacy state", () => {
  expect(
    executionRecoveryPending(attempt, {
      batches: [],
    } as unknown as PaymentSnapshot),
  ).toBe(true);
  expect(
    executionRecoveryPending({ batchId: "batch" }, snapshot("approved")),
  ).toBe(true);
});
