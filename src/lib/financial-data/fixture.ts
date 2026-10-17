import { randomUUID } from "node:crypto";
import {
  AccountSummarySchema,
  HistoryQuerySchema,
  type AccountRecord,
  type BankingDataSource,
  type Coverage,
  type FinancialRepository,
  type NormalizedTransaction,
  type PermissionContext,
  type Scope,
} from "./contracts";
import {
  fail,
  fingerprint,
  parseProvider,
  transactionTime,
  trustedNow,
} from "./core";
import { createAuthorizer } from "./permissions";
import { MemoryFinancialRepository, type FixtureDataset } from "./repository";

export const FIXTURE_SEED = "agus-fictional-ng-v1";
export const FIXTURE_NOW = "2026-10-17T10:00:00.000Z";
export const FIXTURE_LABEL =
  "Fictional AGUS demonstration; no bank connection or real payment";
export const fixturePrincipal = {
  tenantId: "fictional-tenant",
  actorId: "fictional-amina",
  requestId: "fixture-request",
  now: FIXTURE_NOW,
} as const;
export const fixtureOtherPrincipal = {
  ...fixturePrincipal,
  actorId: "fictional-tunde",
};
export const FIXTURE_EXPECTED_OCTOBER = {
  expenseKobo: 1975151,
  incomeKobo: 25000000,
  netKobo: 23024849,
  includedCount: 66,
} as const;

/** Fixed seed is a manifest/version, not a random generator. All names/accounts are invented. */
export function createFixtureDataset(): FixtureDataset {
  const makeConsent = (ownerId: string, id: string, accountIds: string[]) => ({
    id,
    tenantId: "fictional-tenant",
    ownerId,
    provider: "fixture" as const,
    mode: "fixture" as const,
    accountIds,
    scopes: ["accounts:read", "transactions:read", "evidence:read"] as Scope[],
    purpose: "financial_assistant" as const,
    state: "active" as const,
    grantedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: null,
    version: 1,
  });
  const consents = [
    makeConsent("fictional-amina", "consent-amina", [
      "amina-current",
      "amina-savings",
    ]),
    makeConsent("fictional-tunde", "consent-tunde", ["tunde-current"]),
  ];
  const accounts: AccountRecord[] = consents.flatMap((c) =>
    c.accountIds.map((accountId) => ({
      tenantId: c.tenantId,
      ownerId: c.ownerId,
      accountId,
      provider: "fixture",
      mode: "fixture",
      displayName: `Fictional ${accountId}`,
      maskedNumber: accountId === "amina-current" ? "0042" : "0081",
      currency: "NGN",
      consentId: c.id,
      simulated: true,
      lastSyncedAt: accountId === "amina-savings" ? null : FIXTURE_NOW,
    })),
  );
  const a = accounts[0];
  function tx(
    id: string,
    amountKobo: number,
    at: string | null,
    patch: Partial<NormalizedTransaction> = {},
    account = a,
  ): NormalizedTransaction {
    return {
      tenantId: account.tenantId,
      ownerId: account.ownerId,
      accountId: account.accountId,
      schemaVersion: 1,
      id,
      revision: 1,
      currency: "NGN",
      amountKobo,
      direction: "debit",
      status: "posted",
      occurredAt: at,
      bookedAt: at,
      observedAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
      counterparty: {
        displayName: "Fictional Lagos Market",
        institution: "Fictional Demo Bank",
      },
      description: "Synthetic household purchase",
      reference: `SYNTHETIC-${id}`,
      category: { value: "shopping", source: "fixture" },
      search: { normalizedText: "", tokens: [], version: 1 },
      provenance: {
        provider: "fixture",
        mode: "fixture",
        providerTransactionId: `provider-${id}`,
        providerAccountRef: account.accountId,
        consentId: account.consentId,
        fetchedAt: FIXTURE_NOW,
        rawRecordRef: null,
        rawRecordSha256: null,
        timestampBasis: "fixture",
      },
      evidenceIds: [],
      reversalOfId: null,
      simulated: true,
      simulationLabel: FIXTURE_LABEL,
      ...patch,
    };
  }
  const transactions = [
    tx("ada-okafor-oct", 500000, "2026-10-05T12:00:00.000Z", {
      counterparty: {
        displayName: "Ada Okafor (fictional)",
        institution: null,
      },
      category: { value: "services", source: "fixture" },
      evidenceIds: ["evidence-ada"],
    }),
    tx("ada-obi-oct", 750000, "2026-10-07T12:00:00.000Z", {
      counterparty: { displayName: "Ada Obi (fictional)", institution: null },
      category: { value: "services", source: "fixture" },
    }),
    tx("ada-september", 100000, "2026-09-10T12:00:00.000Z", {
      description: "Synthetic payment to Ada last month",
    }),
    tx("ada-previous-year", 200000, "2025-10-05T12:00:00.000Z", {
      description: "Synthetic payment to Ada last year",
    }),
    tx("before-october", 99999, "2026-09-30T22:59:59.999Z"),
    tx("october-midnight", 100, "2026-09-30T23:00:00.000Z"),
    tx("november-midnight", 88888, "2026-10-31T23:00:00.000Z"),
    tx("salary-oct", 25000000, "2026-10-01T08:00:00.000Z", {
      direction: "credit",
      description: "Synthetic monthly salary",
      category: { value: "salary", source: "fixture" },
    }),
    tx("lunch-oct", 125050, "2026-10-02T12:00:00.000Z", {
      category: { value: "food", source: "fixture" },
    }),
    tx("one-kobo", 1, "2026-10-02T13:00:00.000Z"),
    tx("pending-oct", 100000, "2026-10-03T12:00:00.000Z", {
      status: "pending",
    }),
    tx("failed-oct", 150000, "2026-10-03T13:00:00.000Z", { status: "failed" }),
    tx("reversed-oct", 200000, "2026-10-03T14:00:00.000Z", {
      status: "reversed",
    }),
    tx("return-oct", 200000, "2026-10-04T14:00:00.000Z", {
      direction: "credit",
      reversalOfId: "reversed-oct",
    }),
    tx("unknown-oct", 300000, "2026-10-03T15:00:00.000Z", {
      status: "unknown",
    }),
    tx("undated", 40000, null),
    ...Array.from({ length: 60 }, (_, i) =>
      tx(
        `market-${String(i).padStart(2, "0")}`,
        10000,
        new Date(Date.UTC(2026, 9, 10, 9, i)).toISOString(),
      ),
    ),
    tx("tunde-private", 777777, "2026-10-05T12:00:00.000Z", {}, accounts[2]),
  ];
  return {
    accounts,
    consents,
    transactions,
    evidence: [
      {
        tenantId: a.tenantId,
        ownerId: a.ownerId,
        accountId: a.accountId,
        id: "evidence-ada",
        transactionId: "ada-okafor-oct",
        kind: "synthetic_record",
        provider: "fixture",
        mode: "fixture",
        sourceReference: "SYNTHETIC-ada-okafor-oct",
        observedAt: FIXTURE_NOW,
        sourceStatus: "fictional posted record",
        artifactRef: null,
        sha256: null,
        limitations: [
          FIXTURE_LABEL,
          "Does not establish recipient bank credit or an authentic receipt",
        ],
        simulated: true,
      },
    ],
    summaries: [
      {
        tenantId: a.tenantId,
        ownerId: a.ownerId,
        accountId: a.accountId,
        currency: "NGN",
        availableKobo: 12345678,
        currentKobo: 12445678,
        asOf: FIXTURE_NOW,
        simulated: true,
        unavailableReason: null,
      },
    ],
  };
}
export const createFixtureRepository = () =>
  new MemoryFinancialRepository(createFixtureDataset());

type ProviderSnapshot = {
  fingerprint: string;
  revision: string;
  expires: number;
  offset: number;
  rows: NormalizedTransaction[];
  coverage: Coverage;
};
export function createFixtureDataSource(options: {
  repository: FinancialRepository;
  clock?: () => string;
}): BankingDataSource {
  const { repository } = options;
  const clock = options.clock ?? (() => new Date().toISOString());
  const auth = createAuthorizer(repository, clock);
  const cursors = new Map<string, ProviderSnapshot>();
  async function allowed(
    ctx: PermissionContext,
    consentId: string,
    ids: string[],
    scopes: Scope[],
  ) {
    const c = await auth.consent(ctx, consentId, scopes);
    if (c.provider !== "fixture" || c.mode !== "fixture")
      fail("UNSUPPORTED_CAPABILITY");
    const bindings = await auth.bind(ctx, ids, scopes);
    if (bindings.some((b) => b.consent.id !== c.id)) fail("PERMISSION_DENIED");
    return bindings;
  }
  const source: BankingDataSource = {
    provider: "fixture",
    mode: "fixture",
    async listAccounts(input, consentId) {
      const ctx = auth.context(input),
        c = await auth.consent(ctx, consentId, ["accounts:read"]);
      const bindings = await allowed(ctx, consentId, c.accountIds, [
        "accounts:read",
      ]);
      const rows = await repository.listAccounts(ctx, consentId);
      if (
        rows.length !== bindings.length ||
        rows.some(
          (a) =>
            !bindings.some(
              (b) => JSON.stringify(a) === JSON.stringify(b.account),
            ),
        )
      )
        fail("INVALID_PROVIDER_DATA");
      await auth.recheck(ctx, bindings, ["accounts:read"]);
      return rows;
    },
    async getTransactions(input, consentId, untrustedQuery) {
      const ctx = auth.context(input);
      const parsed = HistoryQuerySchema.safeParse(untrustedQuery);
      if (!parsed.success) fail("INVALID_ARGUMENT");
      const q = parsed.data,
        bindings = await allowed(ctx, consentId, q.accountIds, [
          "transactions:read",
        ]);
      const revision = await repository.getRevision(ctx, q.accountIds);
      const key = fingerprint({
        principal: [ctx.tenantId, ctx.actorId],
        consentId,
        query: { ...q, cursor: null },
        versions: bindings.map((b) => b.consent.version),
      });
      let snapshot: ProviderSnapshot;
      if (q.cursor) {
        const found = cursors.get(q.cursor);
        if (!found || found.fingerprint !== key) fail("CURSOR_INVALID");
        if (
          found.expires <= Date.parse(trustedNow(clock)) ||
          found.revision !== revision
        ) {
          cursors.delete(q.cursor);
          fail("SNAPSHOT_EXPIRED");
        }
        // Reclaim the consumed capability, including terminal-page cursors.
        // No await between lookup and claim, so concurrent replay cannot fork it.
        cursors.delete(q.cursor);
        snapshot = found;
      } else {
        const rows = (
          await Promise.all(
            q.accountIds.map((id) => repository.listTransactions(ctx, id)),
          )
        )
          .flat()
          .filter((t) => {
            const at = transactionTime(t);
            return (
              at === null ||
              (Date.parse(at) >= Date.parse(q.from) &&
                Date.parse(at) < Date.parse(q.toExclusive))
            );
          })
          .sort(
            (a, b) =>
              a.accountId.localeCompare(b.accountId) ||
              a.id.localeCompare(b.id),
          );
        const undatedCount = rows.filter(
          (t) => transactionTime(t) === null,
        ).length;
        const synced = bindings.map((b) => b.account.lastSyncedAt);
        const reasons: Coverage["reasons"] = [];
        if (undatedCount) reasons.push("UNDATED_RECORDS");
        if (synced.includes(null)) reasons.push("NOT_SYNCED");
        snapshot = {
          fingerprint: key,
          revision,
          expires: Date.parse(trustedNow(clock)) + 900000,
          offset: 0,
          rows,
          coverage: {
            from: q.from,
            toExclusive: q.toExclusive,
            state: synced.includes(null)
              ? "unknown"
              : reasons.length
                ? "partial"
                : "complete",
            missingAccountIds: [],
            undatedCount,
            lastSyncedAt: synced.includes(null) ? null : synced.sort()[0],
            reasons,
          },
        };
      }
      const items = structuredClone(
        snapshot.rows.slice(snapshot.offset, snapshot.offset + q.limit),
      );
      await auth.recheck(ctx, bindings, ["transactions:read"]);
      if (revision !== (await repository.getRevision(ctx, q.accountIds)))
        fail("SNAPSHOT_EXPIRED");
      const now = Date.parse(trustedNow(clock));
      if (snapshot.expires <= now) fail("SNAPSHOT_EXPIRED");
      let nextCursor: string | null = null;
      if (snapshot.offset + items.length < snapshot.rows.length) {
        for (const [token, s] of cursors)
          if (s.expires <= now) cursors.delete(token);
        if (cursors.size >= 200) fail("LIMIT_EXCEEDED");
        nextCursor = randomUUID();
        cursors.set(nextCursor, {
          ...snapshot,
          offset: snapshot.offset + items.length,
        });
      }
      return {
        items,
        nextCursor,
        coverage: structuredClone(snapshot.coverage),
      };
    },
    async getTransaction(input, consentId, accountId, transactionId) {
      const ctx = auth.context(input),
        bindings = await allowed(
          ctx,
          consentId,
          [accountId],
          ["transactions:read"],
        );
      const row = await repository.getTransaction(
        ctx,
        accountId,
        transactionId,
      );
      await auth.recheck(ctx, bindings, ["transactions:read"]);
      return row;
    },
    async getEvidence(input, consentId, accountId, transactionId) {
      const ctx = auth.context(input),
        bindings = await allowed(
          ctx,
          consentId,
          [accountId],
          ["transactions:read", "evidence:read"],
        );
      const rows = await repository.getEvidence(ctx, accountId, transactionId);
      await auth.recheck(ctx, bindings, ["transactions:read", "evidence:read"]);
      return rows;
    },
    async getAccountSummary(input, consentId, accountId) {
      const ctx = auth.context(input),
        bindings = await allowed(
          ctx,
          consentId,
          [accountId],
          ["accounts:read"],
        );
      let summary = await repository.getAccountSummary(ctx, accountId);
      summary ??= {
        accountId,
        currency: "NGN",
        availableKobo: null,
        currentKobo: null,
        asOf: null,
        simulated: true,
        unavailableReason: "not_provided",
      };
      summary = parseProvider(AccountSummarySchema, summary);
      if (
        summary.asOf &&
        Date.parse(trustedNow(clock)) - Date.parse(summary.asOf) > 86400000
      )
        summary = {
          ...summary,
          availableKobo: null,
          currentKobo: null,
          unavailableReason: "stale",
        };
      await auth.recheck(ctx, bindings, ["accounts:read"]);
      return summary;
    },
    async revokeConsent(input, consentId) {
      const ctx = auth.context(input);
      const c = await repository.getConsent(ctx, consentId);
      if (!c) fail("NOT_FOUND");
      if (c.provider !== "fixture") fail("UNSUPPORTED_CAPABILITY");
      await repository.revokeConsent(ctx, consentId, trustedNow(clock));
    },
  };
  return Object.freeze(source);
}
