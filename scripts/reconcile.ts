import { readState } from "../src/lib/db";
import { reconcileBatch } from "../src/lib/payments";
import { config } from "../src/lib/config";
// Read-only provider calls. This job cannot submit or retry a transfer.
const state = await readState();
for (const b of state.batches.filter(
  (b) =>
    b.mode === config().mode &&
    b.approval?.consumedAt &&
    b.payments.some((p) =>
      ["submitted", "processing", "unknown", "awaiting_otp"].includes(p.status),
    ),
)) {
  await reconcileBatch(b.owner, b.id);
  console.log(`Reconciled batch ${b.id}`);
}
process.exit(0);
