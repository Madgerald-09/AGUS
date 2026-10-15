import { reconcileOutstanding } from "../src/lib/payments";
// Read-only provider verification, including unfinished webhook work on successful payments.
await reconcileOutstanding();
console.log("Reconciled outstanding payments and webhook work");
process.exit(0);
