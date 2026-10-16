import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, type Instruction, type Payment, type Mode } from "./domain";
import { config } from "./config";
export interface Bank {
  name: string;
  code: string;
}
export interface TransferData {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  transfer_code?: string;
  domain?: string;
  integration?: number;
  recipient?:
    | string
    | number
    | {
        recipient_code?: string;
        id?: number;
        details?: { account_number?: string; bank_code?: string };
      };
  fee_charged?: number;
  fees?: number;
}
export interface ProviderResult<T> {
  data: T;
  raw: unknown;
}
export interface PaymentProvider {
  mode: Mode;
  banks(): Promise<Bank[]>;
  resolve(
    account: string,
    bank: string,
  ): Promise<ProviderResult<{ account_number: string; account_name: string }>>;
  recipient(
    p: Instruction,
    name: string,
  ): Promise<ProviderResult<{ recipient_code: string; id?: number }>>;
  balance(): Promise<ProviderResult<number>>;
  submit(p: Payment): Promise<ProviderResult<TransferData>>;
  verify(p: Payment): Promise<ProviderResult<TransferData>>;
  finalize(p: Payment, otp: string): Promise<ProviderResult<TransferData>>;
}
const transferSchema = z
  .object({
    reference: z.string(),
    amount: z.number().int().nonnegative().safe(),
    currency: z.string(),
    status: z.string(),
    transfer_code: z.string().optional(),
    domain: z.string().optional(),
    integration: z.number().optional(),
    recipient: z
      .union([
        z.string(),
        z.number().int().positive().safe(),
        z
          .object({
            recipient_code: z.string().optional(),
            id: z.number().int().positive().safe().optional(),
            details: z
              .object({
                account_number: z.string().optional(),
                bank_code: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      ])
      .optional(),
    fee_charged: z.number().int().nonnegative().safe().optional(),
    fees: z.number().int().nonnegative().safe().optional(),
  })
  .passthrough();
// Both response fields are integer kobo, never naira or estimated reserves.
export function confirmedFeeKobo(data: TransferData) {
  for (const fee of [data.fee_charged, data.fees])
    if (fee !== undefined && (!Number.isSafeInteger(fee) || fee < 0))
      throw new AppError("Invalid confirmed provider fee", 502);
  if (
    data.fee_charged !== undefined &&
    data.fees !== undefined &&
    data.fee_charged !== data.fees
  )
    throw new AppError("Conflicting confirmed provider fees", 502);
  return data.fee_charged ?? data.fees;
}

export function recipientIdentity(value: TransferData["recipient"]): {
  code?: string;
  recipientId?: number;
  accountNumber?: string;
  bankCode?: string;
} {
  const codeSchema = z.string().regex(/^RCP_[A-Za-z0-9_]+$/);
  const idSchema = z.number().int().positive().safe();
  if (value === undefined) return {};
  if (typeof value === "string") return { code: codeSchema.parse(value) };
  if (typeof value === "number") return { recipientId: idSchema.parse(value) };
  const parsed = z
    .object({
      recipient_code: codeSchema.optional(),
      id: idSchema.optional(),
      details: z
        .object({
          account_number: z
            .string()
            .regex(/^\d{10}$/)
            .optional(),
          bank_code: z
            .string()
            .regex(/^\d{3,6}$/)
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .parse(value);
  return {
    code: parsed.recipient_code,
    recipientId: parsed.id,
    accountNumber: parsed.details?.account_number,
    bankCode: parsed.details?.bank_code,
  };
}
export class ProviderError extends AppError {
  constructor(
    message: string,
    public raw: unknown,
  ) {
    super(message, 502);
  }
}
export class Paystack implements PaymentProvider {
  constructor(
    public mode: "test" | "live",
    private key: string,
    private transport: typeof fetch = fetch,
  ) {
    if (!key.startsWith(mode === "live" ? "sk_live_" : "sk_test_"))
      throw new AppError(`A matching Paystack ${mode} secret is required`, 503);
  }
  private async call<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<ProviderResult<T>> {
    let raw: unknown;
    try {
      const res = await this.transport(`https://api.paystack.co${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
      raw = await res.json();
      const envelope = z
        .object({
          status: z.boolean(),
          data: z.unknown().optional(),
          message: z.string().optional(),
        })
        .parse(raw);
      if (!res.ok || !envelope.status)
        throw new ProviderError(
          envelope.message ?? "Provider request rejected",
          raw,
        );
      return { data: schema.parse(envelope.data), raw };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(
        "Provider response unavailable or invalid; verify before any further action",
        raw ?? { error: e instanceof Error ? e.name : "NetworkError" },
      );
    }
  }
  async banks() {
    // /bank documents use_cursor + meta.next, not an offset page parameter.
    // Page length is not a termination signal (including an exact full page).
    const banks = new Map<string, Bank>();
    const seenCursors = new Set<string>();
    let next: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({
        country: "nigeria",
        currency: "NGN",
        perPage: "100",
        use_cursor: "true",
      });
      if (next) query.set("next", next);
      const result = await this.call(
        `/bank?${query}`,
        z
          .array(z.object({ name: z.string().min(1), code: z.string().min(1) }))
          .max(100),
      );
      const pagination = z
        .object({
          meta: z
            .object({ next: z.string().max(2048).nullable().optional() })
            .optional(),
        })
        .safeParse(result.raw);
      if (!pagination.success)
        throw new AppError("Bank listing returned invalid pagination", 502);
      const before = banks.size;
      for (const bank of result.data)
        if (!banks.has(bank.code)) banks.set(bank.code, bank);
      next = pagination.data.meta?.next ?? undefined;
      // Paystack can omit meta for a non-paginated list, and represents an
      // exhausted cursor as null, empty, or the literal string "null".
      if (!next || next === "null") return [...banks.values()];
      if (seenCursors.has(next) || banks.size === before)
        throw new AppError("Bank listing pagination made no progress", 502);
      seenCursors.add(next);
    }
    throw new AppError("Bank listing exceeded pagination limit", 502);
  }

  resolve(account: string, bank: string) {
    return this.call(
      `/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bank)}`,
      z.object({ account_number: z.string(), account_name: z.string().min(1) }),
    );
  }
  recipient(p: Instruction, name: string) {
    return this.call(
      "/transferrecipient",
      z.object({
        recipient_code: z.string().startsWith("RCP_"),
        id: z.number().int().positive().safe().optional(),
      }),
      {
        type: "nuban",
        name,
        account_number: p.accountNumber,
        bank_code: p.bankCode,
        currency: "NGN",
      },
    );
  }
  async balance() {
    const r = await this.call(
      "/balance",
      z.array(
        z.object({
          currency: z.string(),
          balance: z.number().int().nonnegative(),
        }),
      ),
    );
    const n = r.data.find((x) => x.currency === "NGN");
    if (!n) throw new ProviderError("NGN transfer balance unavailable", r.raw);
    return { data: n.balance, raw: r.raw };
  }
  submit(p: Payment) {
    return this.call("/transfer", transferSchema, {
      source: "balance",
      amount: p.amountKobo,
      recipient: p.recipientCode,
      reference: p.reference,
      reason: p.reason,
      currency: "NGN",
    });
  }
  verify(p: Payment) {
    return this.call(
      `/transfer/verify/${encodeURIComponent(p.reference)}`,
      transferSchema,
    );
  }
  finalize(p: Payment, otp: string) {
    return this.call("/transfer/finalize_transfer", transferSchema, {
      transfer_code: p.transferCode,
      otp,
    });
  }
}
export const fixtureBanks = [
  { name: "Wema Bank", code: "035" },
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "United Bank for Africa", code: "033" },
];
export const fixtureBeneficiaries = [
  { name: "Ada Okafor", bankCode: "035", accountNumber: "0000000001" },
  { name: "Chidi Nwosu", bankCode: "044", accountNumber: "0000000002" },
  { name: "Demo Reversal", bankCode: "058", accountNumber: "0000000003" },
  { name: "Demo Failure", bankCode: "033", accountNumber: "0000000004" },
];
export class FixtureProvider implements PaymentProvider {
  mode = "fixture" as const;
  async banks() {
    return fixtureBanks;
  }
  async resolve(account: string, bank: string) {
    const p = fixtureBeneficiaries.find(
      (x) => x.accountNumber === account && x.bankCode === bank,
    );
    if (!p)
      throw new AppError(
        "Fixture account not found. Use a listed fictional beneficiary.",
      );
    const data = {
      account_number: account,
      account_name: p.name.toUpperCase(),
    };
    return { data, raw: { fixture: true, data } };
  }
  async recipient(p: Instruction) {
    const data = {
      recipient_code: `RCP_fixture_${p.bankCode}_${p.accountNumber}`,
    };
    return { data, raw: { fixture: true, data } };
  }
  async balance(): Promise<ProviderResult<number>> {
    return { data: 100000000, raw: { fixture: true, balance: 100000000 } };
  }
  async submit(p: Payment) {
    const data = {
      reference: p.reference,
      amount: p.amountKobo,
      currency: "NGN",
      status: "pending",
      transfer_code: `TRF_fixture_${p.id}`,
      domain: "test",
      recipient: p.recipientCode,
    };
    return { data, raw: { fixture: true, data } };
  }
  async verify(p: Payment): Promise<ProviderResult<TransferData>> {
    const status = p.accountNumber.endsWith("2")
      ? "pending"
      : p.accountNumber.endsWith("3")
        ? "reversed"
        : p.accountNumber.endsWith("4")
          ? "failed"
          : "success";
    const data = {
      reference: p.reference,
      amount: p.amountKobo,
      currency: "NGN",
      status,
      transfer_code: p.transferCode,
      domain: "test",
      fees: 0,
      recipient: p.recipientCode,
    };
    return { data, raw: { fixture: true, data } };
  }
  async finalize(p: Payment, _otp: string) {
    return this.verify(p);
  }
}
export function provider(): PaymentProvider {
  const c = config();
  return c.mode === "fixture"
    ? new FixtureProvider()
    : new Paystack(c.mode, c.key);
}
export function verifySignature(
  raw: string,
  signature: string | null,
  key: string,
) {
  if (!key || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
