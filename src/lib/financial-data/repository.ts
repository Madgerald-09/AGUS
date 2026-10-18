import { z } from "zod";
import {
  AccountRecordSchema,
  AccountSummarySchema,
  ConsentSchema,
  EvidenceRecordSchema,
  OwnershipSchema,
  NormalizedTransactionSchema,
  type AccountRecord,
  type AccountSummary,
  type Consent,
  type EvidenceRecord,
  type FinancialRepository,
  type NormalizedTransaction,
  type Principal,
} from "./contracts";
import { fail, fingerprint, normalizeTransaction, parseProvider } from "./core";

export const FixtureDatasetSchema = z.strictObject({
  accounts: z.array(AccountRecordSchema).max(100),
  consents: z.array(ConsentSchema).max(100),
  transactions: z.array(NormalizedTransactionSchema).max(10000),
  evidence: z.array(EvidenceRecordSchema).max(10000),
  summaries: z
    .array(AccountSummarySchema.safeExtend(OwnershipSchema.shape))
    .max(100),
});
export type FixtureDataset = Omit<
  z.infer<typeof FixtureDatasetSchema>,
  "transactions"
> & { transactions: NormalizedTransaction[] };
const owned = (p: Principal, v: { tenantId: string; ownerId: string }) =>
  v.tenantId === p.tenantId && v.ownerId === p.actorId;
const sameOwner = (
  a: { tenantId: string; ownerId: string; accountId: string },
  b: { tenantId: string; ownerId: string; accountId: string },
) =>
  a.tenantId === b.tenantId &&
  a.ownerId === b.ownerId &&
  a.accountId === b.accountId;
const clone = <T>(v: T): T => structuredClone(v);
const accountKey = (v: {
  tenantId: string;
  ownerId: string;
  accountId: string;
}) => JSON.stringify([v.tenantId, v.ownerId, v.accountId]);
const txKey = (t: NormalizedTransaction) =>
  JSON.stringify([
    t.tenantId,
    t.ownerId,
    t.accountId,
    t.provenance.provider,
    t.provenance.mode,
    t.provenance.providerTransactionId,
  ]);

function validateDataset(input: unknown): FixtureDataset {
  const d = parseProvider(FixtureDatasetSchema, input);
  const transactions: NormalizedTransaction[] = [];
  for (const value of d.transactions) {
    const t = normalizeTransaction(value);
    const prior = transactions.findIndex((r) => txKey(r) === txKey(t));
    if (prior < 0) transactions.push(t);
    else {
      const old = transactions[prior];
      if (
        old.id !== t.id ||
        t.revision < old.revision ||
        (t.revision === old.revision && fingerprint(old) !== fingerprint(t))
      )
        fail("INVALID_PROVIDER_DATA");
      transactions[prior] = t;
    }
  }
  const data = { ...d, transactions };
  const unique = <T>(items: T[], key: (v: T) => string) => {
    if (new Set(items.map(key)).size !== items.length)
      fail("INVALID_PROVIDER_DATA");
  };
  unique(data.accounts, accountKey);
  unique(data.consents, (v) => JSON.stringify([v.tenantId, v.ownerId, v.id]));
  unique(data.transactions, (v) => JSON.stringify([accountKey(v), v.id]));
  unique(data.evidence, (v) => JSON.stringify([accountKey(v), v.id]));
  unique(data.summaries, accountKey);
  for (const a of data.accounts) {
    const c = data.consents.find(
      (v) =>
        v.tenantId === a.tenantId &&
        v.ownerId === a.ownerId &&
        v.id === a.consentId,
    );
    if (
      !c ||
      !c.accountIds.includes(a.accountId) ||
      c.provider !== a.provider ||
      c.mode !== a.mode
    )
      fail("INVALID_PROVIDER_DATA");
  }
  for (const c of data.consents)
    for (const id of c.accountIds) {
      if (
        !data.accounts.some(
          (a) =>
            a.tenantId === c.tenantId &&
            a.ownerId === c.ownerId &&
            a.accountId === id &&
            a.consentId === c.id,
        )
      )
        fail("INVALID_PROVIDER_DATA");
    }
  for (const t of data.transactions) {
    const a = data.accounts.find((v) => sameOwner(t, v));
    if (
      !a ||
      a.provider !== t.provenance.provider ||
      a.mode !== t.provenance.mode ||
      a.consentId !== t.provenance.consentId ||
      a.simulated !== t.simulated
    )
      fail("INVALID_PROVIDER_DATA");
    if (t.reversalOfId) {
      const original = data.transactions.find(
        (v) => sameOwner(t, v) && v.id === t.reversalOfId,
      );
      if (
        !original ||
        original.direction !== "debit" ||
        original.status !== "reversed" ||
        original.reversalOfId ||
        original.amountKobo !== t.amountKobo ||
        original.provenance.provider !== t.provenance.provider
      )
        fail("INVALID_PROVIDER_DATA");
    }
    for (const id of t.evidenceIds)
      if (
        !data.evidence.some(
          (v) => sameOwner(t, v) && v.id === id && v.transactionId === t.id,
        )
      )
        fail("INVALID_PROVIDER_DATA");
  }
  for (const e of data.evidence) {
    const t = data.transactions.find(
      (v) => sameOwner(e, v) && v.id === e.transactionId,
    );
    if (
      !t ||
      !t.evidenceIds.includes(e.id) ||
      t.provenance.provider !== e.provider ||
      t.provenance.mode !== e.mode ||
      t.simulated !== e.simulated
    )
      fail("INVALID_PROVIDER_DATA");
  }
  for (const s of data.summaries) {
    const a = data.accounts.find((v) => sameOwner(s, v));
    if (!a || a.simulated !== s.simulated) fail("INVALID_PROVIDER_DATA");
  }
  return data;
}

/** In-memory server-side read model. Never touches the existing payment ledger. */
export class MemoryFinancialRepository implements FinancialRepository {
  private data: FixtureDataset;
  constructor(input: unknown) {
    this.data = validateDataset(input);
  }
  async getConsent(p: Principal, id: string): Promise<Consent | null> {
    return clone(
      this.data.consents.find((v) => owned(p, v) && v.id === id) ?? null,
    );
  }
  async getAccount(p: Principal, id: string): Promise<AccountRecord | null> {
    return clone(
      this.data.accounts.find((v) => owned(p, v) && v.accountId === id) ?? null,
    );
  }
  async listAccounts(
    p: Principal,
    consentId: string,
  ): Promise<AccountRecord[]> {
    return clone(
      this.data.accounts.filter(
        (v) => owned(p, v) && v.consentId === consentId,
      ),
    );
  }
  async listTransactions(
    p: Principal,
    accountId: string,
  ): Promise<NormalizedTransaction[]> {
    return clone(
      this.data.transactions.filter(
        (v) => owned(p, v) && v.accountId === accountId,
      ),
    );
  }
  async getTransaction(
    p: Principal,
    accountId: string,
    id: string,
  ): Promise<NormalizedTransaction | null> {
    return clone(
      this.data.transactions.find(
        (v) => owned(p, v) && v.accountId === accountId && v.id === id,
      ) ?? null,
    );
  }
  async getEvidence(
    p: Principal,
    accountId: string,
    transactionId: string,
  ): Promise<EvidenceRecord[]> {
    return clone(
      this.data.evidence.filter(
        (v) =>
          owned(p, v) &&
          v.accountId === accountId &&
          v.transactionId === transactionId,
      ),
    );
  }
  async getAccountSummary(
    p: Principal,
    accountId: string,
  ): Promise<AccountSummary | null> {
    const s = this.data.summaries.find(
      (v) => owned(p, v) && v.accountId === accountId,
    );
    if (!s) return null;
    const { tenantId: _tenantId, ownerId: _ownerId, ...summary } = s;
    return clone(summary);
  }
  async getRevision(p: Principal, accountIds: string[]): Promise<string> {
    const accounts = this.data.accounts.filter(
      (a) => owned(p, a) && accountIds.includes(a.accountId),
    );
    return fingerprint({
      accounts,
      consents: this.data.consents.filter(
        (c) => owned(p, c) && accounts.some((a) => a.consentId === c.id),
      ),
      transactions: this.data.transactions.filter(
        (t) => owned(p, t) && accountIds.includes(t.accountId),
      ),
      evidence: this.data.evidence.filter(
        (e) => owned(p, e) && accountIds.includes(e.accountId),
      ),
      summaries: this.data.summaries.filter(
        (s) => owned(p, s) && accountIds.includes(s.accountId),
      ),
    });
  }
  async revokeConsent(p: Principal, id: string, now: string): Promise<void> {
    const c = await this.getConsent(p, id);
    if (!c) fail("NOT_FOUND");
    if (c.state === "revoked") return;
    const updated = ConsentSchema.parse({
      ...c,
      state: "revoked",
      revokedAt: now,
      version: c.version + 1,
    });
    this.data.consents = this.data.consents.map((v) =>
      owned(p, v) && v.id === id ? updated : v,
    );
  }
  /** Administrative ingestion, deliberately absent from FinancialRepository and tool registry. Atomic validation. */
  ingestTransactions(input: unknown[]): {
    accepted: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const rows: NormalizedTransaction[] = [];
    for (const value of input) {
      if (
        value &&
        typeof value === "object" &&
        "amountKobo" in value &&
        value.amountKobo === 0
      ) {
        // Validate all other fields by temporarily substituting a one-kobo magnitude.
        normalizeTransaction({ ...value, amountKobo: 1 });
        warnings.push("ZERO_VALUE_EXCLUDED");
      } else rows.push(normalizeTransaction(value));
    }
    const next = validateDataset({
      ...this.data,
      transactions: [...this.data.transactions, ...rows],
    });
    this.data = next;
    return { accepted: rows.length, warnings: [...new Set(warnings)] };
  }
}
