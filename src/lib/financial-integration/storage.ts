import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  MemoryFinancialRepository,
  type FixtureDataset,
} from "../financial-data/repository";
import { createFixtureDataset } from "../financial-data/fixture";
import {
  InstantSchema,
  type FinancialRepository,
  type Principal,
} from "../financial-data/contracts";
import {
  FinancialDataError,
  normalizeTransaction,
} from "../financial-data/core";

// Separate from workflow_state. Composite keys make account/evidence ownership structural.
const ddl = `
CREATE TABLE IF NOT EXISTS fm_consents (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'id',id,'provider','fixture','mode','fixture')));
CREATE TABLE IF NOT EXISTS fm_accounts (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, consent text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',id,'consentId',consent,'provider','fixture','mode','fixture')),
 FOREIGN KEY (tenant, owner, consent) REFERENCES fm_consents(tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_transactions (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, id text NOT NULL,
 provider_id text NOT NULL, occurred_at text, search_text text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, account, id), UNIQUE (tenant, owner, account, provider_id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account,'id',id,'provenance',jsonb_build_object('providerTransactionId',provider_id,'provider','fixture','mode','fixture'))),
 FOREIGN KEY (tenant, owner, account) REFERENCES fm_accounts(tenant, owner, id));
CREATE INDEX IF NOT EXISTS fm_transactions_date ON fm_transactions(tenant, owner, account, occurred_at, id);
CREATE INDEX IF NOT EXISTS fm_transactions_search ON fm_transactions(tenant, owner, account, search_text);
CREATE TABLE IF NOT EXISTS fm_evidence (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, id text NOT NULL,
 transaction_id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (tenant, owner, account, id),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account,'id',id,'transactionId',transaction_id)),
 FOREIGN KEY (tenant, owner, account, transaction_id) REFERENCES fm_transactions(tenant, owner, account, id));
CREATE TABLE IF NOT EXISTS fm_summaries (
 tenant text NOT NULL, owner text NOT NULL, account text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY (tenant, owner, account),
 CHECK (payload @> jsonb_build_object('tenantId',tenant,'ownerId',owner,'accountId',account)),
 FOREIGN KEY (tenant, owner, account) REFERENCES fm_accounts(tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_principals (
 operator_id text PRIMARY KEY, tenant text NOT NULL, owner text NOT NULL);
CREATE TABLE IF NOT EXISTS fm_context (
 tenant text NOT NULL, owner text NOT NULL, id text NOT NULL, revision integer NOT NULL,
 expires_at timestamptz NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (tenant, owner, id));
CREATE TABLE IF NOT EXISTS fm_seed (id text PRIMARY KEY);
`;
let initializing: Promise<void> | undefined;
export function initializeFinancialStorage() {
  return (initializing ??= initialize().catch((error) => {
    initializing = undefined;
    throw error;
  }));
}
async function initialize() {
  const d = await db();
  for (const statement of ddl.split(";").filter((s) => s.trim()))
    await d.execute(sql.raw(statement));
  await d.transaction(async (tx) => {
    const claim = await tx.execute(
      sql`INSERT INTO fm_seed VALUES ('agus-fictional-ng-v1') ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (!claim.rows.length) return;
    const data = createFixtureDataset();
    new MemoryFinancialRepository(data);
    for (const c of data.consents)
      await tx.execute(
        sql`INSERT INTO fm_consents VALUES (${c.tenantId}, ${c.ownerId}, ${c.id}, ${JSON.stringify(c)}::jsonb)`,
      );
    for (const a of data.accounts)
      await tx.execute(
        sql`INSERT INTO fm_accounts VALUES (${a.tenantId}, ${a.ownerId}, ${a.accountId}, ${a.consentId}, ${JSON.stringify(a)}::jsonb)`,
      );
    for (const raw of data.transactions) {
      const t = normalizeTransaction(raw);
      await tx.execute(
        sql`INSERT INTO fm_transactions VALUES (${t.tenantId}, ${t.ownerId}, ${t.accountId}, ${t.id}, ${t.provenance.providerTransactionId}, ${t.occurredAt}, ${t.search.normalizedText}, ${JSON.stringify(t)}::jsonb)`,
      );
    }
    for (const e of data.evidence)
      await tx.execute(
        sql`INSERT INTO fm_evidence VALUES (${e.tenantId}, ${e.ownerId}, ${e.accountId}, ${e.id}, ${e.transactionId}, ${JSON.stringify(e)}::jsonb)`,
      );
    for (const s of data.summaries)
      await tx.execute(
        sql`INSERT INTO fm_summaries VALUES (${s.tenantId}, ${s.ownerId}, ${s.accountId}, ${JSON.stringify(s)}::jsonb)`,
      );
  });
}

async function snapshot(p: Principal) {
  const d = await db();
  // A single SQL statement gives one consistent snapshot. Validate all relational and
  // payload invariants on reload; never accept raw JSON as a trusted read model.
  const result = await d.execute(sql`SELECT jsonb_build_object(
    'consents', (SELECT coalesce(jsonb_agg(payload ORDER BY id), '[]'::jsonb) FROM fm_consents WHERE tenant=${p.tenantId} AND owner=${p.actorId}),
    'accounts', (SELECT coalesce(jsonb_agg(payload ORDER BY id), '[]'::jsonb) FROM fm_accounts WHERE tenant=${p.tenantId} AND owner=${p.actorId}),
    'transactions', (SELECT coalesce(jsonb_agg(payload ORDER BY account,id), '[]'::jsonb) FROM fm_transactions WHERE tenant=${p.tenantId} AND owner=${p.actorId}),
    'evidence', (SELECT coalesce(jsonb_agg(payload ORDER BY account,id), '[]'::jsonb) FROM fm_evidence WHERE tenant=${p.tenantId} AND owner=${p.actorId}),
    'summaries', (SELECT coalesce(jsonb_agg(payload ORDER BY account), '[]'::jsonb) FROM fm_summaries WHERE tenant=${p.tenantId} AND owner=${p.actorId})
  ) AS dataset`);
  const data = result.rows[0].dataset as FixtureDataset;
  for (const rows of Object.values(data))
    for (const row of rows)
      if (row.tenantId !== p.tenantId || row.ownerId !== p.actorId)
        throw new FinancialDataError("INVALID_PROVIDER_DATA");
  return new MemoryFinancialRepository(data);
}

/** Server administrative interface. Never export this repository to the browser/model. */
export function createDurableRepository(): FinancialRepository {
  return {
    getConsent: async (p, id) => (await snapshot(p)).getConsent(p, id),
    getAccount: async (p, id) => (await snapshot(p)).getAccount(p, id),
    listAccounts: async (p, id) => (await snapshot(p)).listAccounts(p, id),
    listTransactions: async (p, id) =>
      (await snapshot(p)).listTransactions(p, id),
    getTransaction: async (p, a, id) =>
      (await snapshot(p)).getTransaction(p, a, id),
    getEvidence: async (p, a, id) => (await snapshot(p)).getEvidence(p, a, id),
    getAccountSummary: async (p, a) =>
      (await snapshot(p)).getAccountSummary(p, a),
    getRevision: async (p, ids) => (await snapshot(p)).getRevision(p, ids),
    async revokeConsent(p, id, now) {
      InstantSchema.parse(now);
      const d = await db();
      const result =
        await d.execute(sql`UPDATE fm_consents SET payload = payload || jsonb_build_object(
        'state', 'revoked', 'revokedAt', ${now}::text, 'version', (payload->>'version')::integer + 1)
        WHERE tenant=${p.tenantId} AND owner=${p.actorId} AND id=${id} RETURNING id`);
      if (!result.rows.length) throw new FinancialDataError("NOT_FOUND");
    },
  };
}
