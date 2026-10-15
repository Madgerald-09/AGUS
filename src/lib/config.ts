import { AppError, type Mode } from "./domain";
function integer(key: string, fallback: number) {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new AppError(`Invalid ${key}`, 503);
  return n;
}
export function config() {
  const mode = process.env.PAYMENT_MODE ?? "fixture";
  if (!["fixture", "test", "live"].includes(mode))
    throw new AppError("Invalid PAYMENT_MODE", 503);
  return {
    mode: mode as Mode,
    key: process.env.PAYSTACK_SECRET_KEY ?? "",
    operator: process.env.OPERATOR_ID ?? "demo-operator",
    maxPayment: integer("MAX_PAYMENT_KOBO", 100000),
    maxBatch: integer("MAX_BATCH_KOBO", 500000),
    feeReserve: integer("FEE_RESERVE_KOBO", 5000),
    allowlist: (process.env.LIVE_BENEFICIARY_ALLOWLIST ?? "")
      .split(",")
      .filter(Boolean),
  };
}
export function executionGate(mode: Mode, emergency: boolean) {
  const c = config();
  if (c.mode !== mode)
    throw new AppError("Payment environment changed; create a new batch", 409);
  if (emergency || process.env.PAYMENTS_EMERGENCY_DISABLED === "true")
    throw new AppError("Transfers are disabled by the emergency switch", 403);
  if (mode === "live") {
    for (const key of [
      "LIVE_TRANSFERS_ENABLED",
      "LIVE_OWNER_AUTHORIZED",
      "PAYSTACK_TRANSFERS_ENABLED",
      "LIVE_WEBHOOK_VALIDATED",
      "LIVE_RECONCILIATION_VALIDATED",
    ])
      if (process.env[key] !== "true")
        throw new AppError(`Live execution disabled: ${key}`, 403);
    if (!process.env.DATABASE_URL?.startsWith("postgres"))
      throw new AppError("Live mode requires managed PostgreSQL", 403);
    if (
      !process.env.APP_ORIGIN?.startsWith("https://") ||
      !process.env.OPERATOR_PASSWORD_HASH ||
      !process.env.PAYSTACK_INTEGRATION_ID ||
      !c.allowlist.length
    )
      throw new AppError("Live security configuration incomplete", 403);
  }
}
