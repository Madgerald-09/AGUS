import { writeFileSync } from "node:fs";
import { readState } from "../src/lib/db";
import { preparePaymentBatch } from "../src/lib/payments";
if (process.argv[2] === "write")
  await preparePaymentBatch("persisted-operator", [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 50000,
      reason: "Persistence test",
    },
  ]);
const state = await readState();
writeFileSync(
  1,
  JSON.stringify({
    reference: state.batches[0]?.payments[0].reference,
    auditCount: state.audit.length,
    batches: state.batches.length,
  }),
);
process.exit(0);
