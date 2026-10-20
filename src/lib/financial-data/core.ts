import { createHash } from "node:crypto";
import { z } from "zod";
import {
  InstantSchema,
  NormalizedTransactionSchema,
  type NormalizedTransaction,
  type ToolErrorCode,
} from "./contracts";

export class FinancialDataError extends Error {
  constructor(readonly code: ToolErrorCode) {
    super(code);
    this.name = "FinancialDataError";
  }
}
export function fail(code: ToolErrorCode): never {
  throw new FinancialDataError(code);
}
export function parseProvider<T>(schema: z.ZodType<T>, input: unknown): T {
  // Currency errors are classified without returning any untrusted payload/error text.
  if (
    input &&
    typeof input === "object" &&
    "currency" in input &&
    input.currency !== "NGN"
  )
    fail("CURRENCY_MISMATCH");
  const p = schema.safeParse(input);
  if (!p.success) fail("INVALID_PROVIDER_DATA");
  return p.data;
}
export const fingerprint = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
export function tokenize(value: string): string[] {
  return [...new Set(normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [])];
}
export function normalizeTransaction(input: unknown): NormalizedTransaction {
  const t = parseProvider(NormalizedTransactionSchema, input);
  const normalizedText = normalizeText(
    [t.counterparty.displayName, t.description, t.reference]
      .filter((v) => v !== null)
      .join(" "),
  );
  return parseProvider(NormalizedTransactionSchema, {
    ...t,
    search: { normalizedText, tokens: tokenize(normalizedText), version: 1 },
  });
}
export const transactionTime = (t: NormalizedTransaction): string | null =>
  t.bookedAt ?? t.occurredAt;
export function safeAdd(a: number, b: number): number {
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    !Number.isSafeInteger(a + b)
  )
    fail("ARITHMETIC_OVERFLOW");
  return a + b;
}
/** Conversion is solely for importing signed synthetic legacy fixtures, never bank data. */
export function signedFixtureAmount(amountKobo: number): {
  amountKobo: number;
  direction: "debit" | "credit";
} {
  if (!Number.isSafeInteger(amountKobo)) fail("ARITHMETIC_OVERFLOW");
  if (amountKobo === 0) fail("INVALID_PROVIDER_DATA");
  return {
    amountKobo: Math.abs(amountKobo),
    direction: amountKobo < 0 ? "debit" : "credit",
  };
}
/** UTC endpoints for explicit Lagos calendar dates. No natural-language date guessing. */
export function lagosDateInterval(
  fromDate: string,
  toDateExclusive: string,
): { from: string; toExclusive: string } {
  function instant(d: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail("INVALID_ARGUMENT");
    const parsed = new Date(`${d}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== d
    )
      fail("INVALID_ARGUMENT");
    return new Date(parsed.getTime() - 3600000).toISOString();
  }
  const from = instant(fromDate),
    toExclusive = instant(toDateExclusive);
  if (
    from >= toExclusive ||
    Date.parse(toExclusive) - Date.parse(from) > 366 * 86400000
  )
    fail("INVALID_ARGUMENT");
  return { from, toExclusive };
}
export function groupKey(
  t: NormalizedTransaction,
  groupBy: "none" | "category" | "week" | "month",
): string {
  if (groupBy === "none") return "all";
  if (groupBy === "category") return t.category?.value ?? "uncategorized";
  const instant = transactionTime(t);
  if (!instant) fail("INVALID_PROVIDER_DATA");
  const local = new Date(Date.parse(instant) + 3600000);
  if (groupBy === "month") return local.toISOString().slice(0, 7);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}
export function trustedNow(clock: () => string): string {
  return InstantSchema.parse(clock());
}
