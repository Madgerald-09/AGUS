// Render-only fixture entrypoint. Do not use this to run live payments.
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";

const env = { ...process.env };
if (!/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL ?? "")) {
  throw new Error("Render preview requires a managed PostgreSQL DATABASE_URL.");
}
const password = env.AGUS_OPERATOR_PASSWORD ?? "";
if (password.length < 14 || password.length > 256) {
  throw new Error("Set AGUS_OPERATOR_PASSWORD in Render to a private password of 14–256 characters.");
}
const salt = randomBytes(16).toString("hex");
env.OPERATOR_PASSWORD_HASH = salt + ":" + scryptSync(password, salt, 64).toString("hex");
delete env.AGUS_OPERATOR_PASSWORD;

// Always enforce a zero-real-money preview, even if a dashboard flag was altered.
env.PAYMENT_MODE = "fixture";
env.FINANCIAL_DEMO_ENABLED = "true";
env.PAYSTACK_SECRET_KEY = "";
env.PAYSTACK_TRANSFERS_ENABLED = "false";
env.LIVE_TRANSFERS_ENABLED = "false";
env.LIVE_OWNER_AUTHORIZED = "false";
env.LIVE_WEBHOOK_VALIDATED = "false";
env.LIVE_RECONCILIATION_VALIDATED = "false";
env.LIVE_BENEFICIARY_ALLOWLIST = "";
env.PAYMENTS_EMERGENCY_DISABLED = "false";

env.AI_PROVIDER = env.AI_API_KEY ? "gemini" : "none";
env.AI_MODEL = env.AI_MODEL || "gemini-3.5-flash-lite";
env.NODE_ENV = "production";

const origin = (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) {
  throw new Error("Render APP_ORIGIN must be the assigned HTTPS web-service origin.");
}
env.APP_ORIGIN = origin;

const port = Number(env.PORT || 10000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Invalid service port.");
}

function run(args) {
  return spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: "inherit" });
}

const migration = run(["--import=tsx", "scripts/migrate.ts"]);
const result = await new Promise((resolve) => migration.once("exit", (code, signal) => resolve({ code, signal })));
if (result.code !== 0) throw new Error("Database initialization failed. AGUS was not started.");

const server = run(["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", String(port)]);
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.kill(sig));
}
server.once("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
