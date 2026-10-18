import { db } from "../src/lib/db";
import { initializeFinancialStorage } from "../src/lib/financial-integration/storage";
await db();
if (process.env.FINANCIAL_DEMO_ENABLED === "true") {
  if ((process.env.PAYMENT_MODE ?? "fixture") !== "fixture")
    throw new Error("Financial demo storage requires fixture payment mode");
  await initializeFinancialStorage();
}
console.log("PostgreSQL schema and demo ledger initialized.");
process.exit(0);
