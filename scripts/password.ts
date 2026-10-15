import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question(
  "Operator password (input visible; use a local terminal): ",
);
rl.close();
if (password.length < 14) throw new Error("Use at least 14 characters");
const salt = randomBytes(16).toString("hex");
console.log(
  `OPERATOR_PASSWORD_HASH=${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
);
