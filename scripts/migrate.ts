import { db } from "../src/lib/db";
await db();
console.log("PostgreSQL schema and demo ledger initialized.");
process.exit(0);
