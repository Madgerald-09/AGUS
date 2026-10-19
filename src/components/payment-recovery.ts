import type { PaymentSnapshot } from "./payment-ui";
export type ExecutionAttempt = { batchId: string; attemptId?: string };
/** A fresh persisted claim protects against another execution. Only an exact
 * rejection receipt can release an unclaimed request; absence proves nothing. */
export function executionRecoveryPending(
  attempt: ExecutionAttempt | null,
  data: PaymentSnapshot,
) {
  if (!attempt) return false;
  const batch = data.batches.find((b) => b.id === attempt.batchId);
  if (!batch) return true;
  if (batch.approval?.consumedAt) return false;
  return (
    !attempt.attemptId ||
    !data.executionRejections?.some(
      (r) => r.batchId === attempt.batchId && r.attemptId === attempt.attemptId,
    )
  );
}
