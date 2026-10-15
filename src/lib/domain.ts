import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
export type Mode = "fixture" | "test" | "live";
export type Status =
  | "draft"
  | "awaiting_beneficiary_verification"
  | "awaiting_user_approval"
  | "approved"
  | "submitted"
  | "processing"
  | "successful"
  | "failed"
  | "reversed"
  | "unknown"
  | "awaiting_otp";
export const accountSchema = z
  .string()
  .regex(/^\d{10}$/, "Enter a 10-digit Nigerian account number");
export const instructionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    bankCode: z.string().regex(/^\d{3,6}$/),
    accountNumber: accountSchema,
    amountKobo: z.number().int().positive().max(100_000_000),
    reason: z.string().trim().max(140).default("Payment"),
  })
  .strict();
export type Instruction = z.infer<typeof instructionSchema>;
export interface Payment extends Instruction {
  id: string;
  reference: string;
  verifiedName?: string;
  recipientCode?: string;
  recipientId?: number;
  verifiedAt?: string;
  status: Status;
  transferCode?: string;
  providerFeeKobo?: number;
  operationGeneration?: number;
  otpFinalization?: {
    claimId: string;
    claimedAt: string;
    generation: number;
    outcome: "claimed" | "recorded" | "uncertain";
  };
  lastError?: string;
  responses: { at: string; operation: string; data: unknown }[];
}
export interface Batch {
  id: string;
  owner: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  version: number;
  payments: Payment[];
  feeReserveKobo: number;
  approval?: {
    actor: string;
    at: string;
    expiresAt: string;
    digest: string;
    nonce: string;
    consumedAt?: string;
  };
  status: Status;
}
export interface Audit {
  id: string;
  at: string;
  actor: string;
  action: string;
  batchId?: string;
  details: unknown;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  owner?: string;
  generation?: "model" | "demo" | "manual";
  proposals?: {
    name: string;
    bankCode: string | null;
    accountNumber: string | null;
    amountNaira: string | null;
    reason: string;
    confidence: "high" | "medium" | "low";
    warnings: string[];
  }[];
  batchId?: string;
  sourceRequest?: string;
  supersededBy?: string;
}
export interface LedgerEntry {
  id: string;
  at: string;
  merchant: string;
  description: string;
  category: string;
  amountKobo: number;
  balanceKobo: number;
  recurring: boolean;
}
export interface State {
  batches: Batch[];
  messages: Message[];
  audit: Audit[];
  webhookIds: string[];
  webhookWork: WebhookWork[];
  ledger: LedgerEntry[];
  emergencyDisabled: boolean;
}
export interface WebhookWork {
  eventId: string;
  batchId: string;
  paymentId: string;
  event: "transfer.success" | "transfer.failed" | "transfer.reversed";
  receivedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const reference = () => `ha_${randomUUID().replaceAll("-", "")}`;
export function nairaToKobo(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new AppError(
      "Use a positive naira amount with at most two decimal places",
    );
  const [a, b = ""] = value.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError("Invalid amount");
  return n;
}
export function total(values: number[]) {
  const n = values.reduce((a, b) => {
    if (!Number.isSafeInteger(b) || b < 0)
      throw new AppError("Invalid monetary value");
    return a + b;
  }, 0);
  if (!Number.isSafeInteger(n)) throw new AppError("Total is too large");
  return n;
}
export const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100,
  );
export const principal = (b: Batch) =>
  total(b.payments.map((p) => p.amountKobo));
export const reserve = (b: Batch) =>
  total([principal(b), b.feeReserveKobo * b.payments.length]);
export function digest(b: Batch) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: b.id,
        owner: b.owner,
        mode: b.mode,
        version: b.version,
        feeReserveKobo: b.feeReserveKobo,
        payments: b.payments.map((p) => ({
          id: p.id,
          reference: p.reference,
          name: p.name,
          verifiedName: p.verifiedName,
          bankCode: p.bankCode,
          accountNumber: p.accountNumber,
          amountKobo: p.amountKobo,
          reason: p.reason,
          recipientCode: p.recipientCode,
          recipientId: p.recipientId,
        })),
      }),
    )
    .digest("hex");
}
export const terminal = (s: Status) =>
  ["successful", "failed", "reversed"].includes(s);
export function providerStatus(s: string): Status {
  return (
    (
      {
        success: "successful",
        failed: "failed",
        reversed: "reversed",
        pending: "processing",
        processing: "processing",
        received: "processing",
        otp: "awaiting_otp",
        abandoned: "failed",
        blocked: "failed",
        rejected: "failed",
      } as Record<string, Status>
    )[s] ?? "unknown"
  );
}
export function transition(old: Status, next: Status): Status {
  if (old === "reversed") return old;
  if (old === "successful" && next !== "reversed") return old;
  if (old === "failed" && next !== "reversed" && next !== "successful")
    return old;
  return next;
}
export function batchStatus(b: Batch): Status {
  const s = b.payments.map((p) => p.status);
  if (s.every((x) => x === "successful")) return "successful";
  if (s.every(terminal)) return s.includes("reversed") ? "reversed" : "failed";
  if (s.includes("unknown")) return "unknown";
  if (s.includes("awaiting_otp")) return "awaiting_otp";
  if (
    s.some((x) =>
      ["submitted", "processing", "successful", "failed", "reversed"].includes(
        x,
      ),
    )
  )
    return "processing";
  if (s.every((x) => x === "approved")) return "approved";
  if (s.every((x) => x === "awaiting_user_approval"))
    return "awaiting_user_approval";
  return "awaiting_beneficiary_verification";
}
export function audit(
  s: State,
  actor: string,
  action: string,
  details: unknown,
  batchId?: string,
) {
  s.audit.push({ id: id(), at: now(), actor, action, details, batchId });
}
export function seedState(): State {
  let balance = 0;
  const ledger: LedgerEntry[] = [];
  const base = new Date();
  base.setUTCHours(8, 0, 0, 0);
  for (let d = 28; d >= 0; d--) {
    const at = new Date(base.getTime() - d * 86400000).toISOString();
    const rows: {
      merchant: string;
      category: string;
      amount: number;
      recurring?: boolean;
    }[] = [];
    if (d === 28 || d === 1)
      rows.push({
        merchant: "Demo stipend",
        category: "Income",
        amount: 15000000,
        recurring: true,
      });
    if (d % 2 === 0)
      rows.push({
        merchant: d < 7 ? "Campus Kitchen" : "Mama T’s Kitchen",
        category: "Food",
        amount: d < 7 ? -420000 : -180000,
      });
    if (d % 3 === 0)
      rows.push({
        merchant: "Lagos transport",
        category: "Transport",
        amount: -100000,
      });
    if (d === 20)
      rows.push({
        merchant: "Demo rent",
        category: "Housing",
        amount: -8000000,
        recurring: true,
      });
    if (d === 10)
      rows.push({
        merchant: "Data subscription",
        category: "Utilities",
        amount: -500000,
        recurring: true,
      });
    for (const r of rows) {
      balance += r.amount;
      ledger.push({
        id: id(),
        at,
        merchant: r.merchant,
        description: "Fictional demonstration transaction",
        category: r.category,
        amountKobo: r.amount,
        balanceKobo: balance,
        recurring: r.recurring ?? false,
      });
    }
  }
  return {
    batches: [],
    messages: [],
    audit: [],
    webhookIds: [],
    webhookWork: [],
    ledger,
    emergencyDisabled: false,
  };
}
