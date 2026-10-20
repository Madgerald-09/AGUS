import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AccountSummarySchema,
  CoverageSchema,
  EvidenceRecordSchema,
  ToolArgsSchemas,
  ToolCallSchema,
  ToolDataSchemas,
  toolResultSchema,
  type BankingDataSource,
  type Coverage,
  type FinancialRepository,
  type NormalizedTransaction,
  type PermissionContext,
  type ReadFilter,
  type ReadToolDispatcher,
  type Scope,
  type ToolCall,
  type ToolData,
  type ToolName,
  type ToolResult,
  type TransactionView,
} from "./contracts";
import {
  fail,
  FinancialDataError,
  fingerprint,
  groupKey,
  normalizeText,
  normalizeTransaction,
  parseProvider,
  safeAdd,
  tokenize,
  transactionTime,
  trustedNow,
} from "./core";
import { createAuthorizer, type AccessBinding } from "./permissions";

export const READ_TOOL_REGISTRY = Object.freeze(
  Object.fromEntries(
    Object.entries(ToolArgsSchemas).map(([name, argsSchema]) => [
      name,
      Object.freeze({ name, argsSchema }),
    ]),
  ) as {
    readonly [K in ToolName]: {
      readonly name: K;
      readonly argsSchema: (typeof ToolArgsSchemas)[K];
    };
  },
);
const pageSchema = z.strictObject({
  items: z.array(z.unknown()).max(50),
  nextCursor: z.string().min(1).max(256).nullable(),
  coverage: CoverageSchema,
});
const scopesFor = (name: ToolName): Scope[] =>
  name === "get_account_summary"
    ? ["accounts:read"]
    : name === "find_payment_evidence"
      ? ["transactions:read", "evidence:read"]
      : ["transactions:read"];
const byteSize = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
const matchesFilter = (
  t: NormalizedTransaction,
  f: ReadFilter,
  includeStatus: boolean,
): boolean => {
  const at = transactionTime(t);
  return (
    at !== null &&
    Date.parse(at) >= Date.parse(f.from) &&
    Date.parse(at) < Date.parse(f.toExclusive) &&
    (!f.direction || f.direction === t.direction) &&
    (!includeStatus || !f.statuses || f.statuses.includes(t.status)) &&
    (!f.category || f.category === t.category?.value) &&
    (!f.amountKobo ||
      (t.amountKobo >= f.amountKobo.min && t.amountKobo <= f.amountKobo.max))
  );
};
function rank(
  t: NormalizedTransaction,
  query: string,
): TransactionView["rankReason"] {
  if (!normalizeText(query)) return "filter_match";
  if (t.reference && normalizeText(t.reference) === normalizeText(query))
    return "exact_reference";
  if (
    t.counterparty.displayName &&
    normalizeText(t.counterparty.displayName) === normalizeText(query)
  )
    return "exact_counterparty";
  return "token_match";
}
function view(
  t: NormalizedTransaction,
  a: AccessBinding["account"],
  query?: string,
): TransactionView {
  return {
    id: t.id,
    accountId: t.accountId,
    accountLabel: `${a.displayName}${a.maskedNumber ? ` •${a.maskedNumber}` : ""}`,
    revision: t.revision,
    amountKobo: t.amountKobo,
    currency: t.currency,
    direction: t.direction,
    status: t.status,
    reversalOfId: t.reversalOfId,
    occurredAt: t.occurredAt,
    bookedAt: t.bookedAt,
    dateBasis: t.bookedAt
      ? "bookedAt"
      : t.occurredAt
        ? "occurredAt"
        : "unknown",
    counterparty: t.counterparty,
    description: t.description,
    reference: t.reference,
    category: t.category,
    simulated: t.simulated,
    simulationLabel: t.simulationLabel,
    source: { provider: t.provenance.provider, mode: t.provenance.mode },
    evidenceIds: t.evidenceIds,
    rankReason: query === undefined ? null : rank(t, query),
  };
}
function mergeCoverage(pages: Coverage[], f: ReadFilter): Coverage {
  return {
    from: f.from,
    toExclusive: f.toExclusive,
    state: pages.some((p) => p.state === "unknown")
      ? "unknown"
      : pages.some((p) => p.state === "partial")
        ? "partial"
        : "complete",
    missingAccountIds: [...new Set(pages.flatMap((p) => p.missingAccountIds))],
    undatedCount: pages.reduce((s, p) => safeAdd(s, p.undatedCount), 0),
    lastSyncedAt: pages.some((p) => p.lastSyncedAt === null)
      ? null
      : (pages.map((p) => p.lastSyncedAt!).sort()[0] ?? null),
    reasons: [...new Set(pages.flatMap((p) => p.reasons))],
  };
}
type SearchSnapshot = {
  principal: string;
  query: string;
  revision: string;
  expires: number;
  rows: NormalizedTransaction[];
  offset: number;
  coverage: Coverage;
};

/** Server-only capability factory. The returned capability has exactly five read operations. */
export function createReadTools(options: {
  repository: FinancialRepository;
  sources: readonly BankingDataSource[];
  clock?: () => string;
  timeoutMs?: number;
}): ReadToolDispatcher {
  const { repository } = options;
  const clock = options.clock ?? (() => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new Error("timeoutMs must be 1..10000");
  const auth = createAuthorizer(repository, clock);
  const sources = new Map<string, BankingDataSource>();
  for (const source of options.sources) {
    const key = `${source.provider}:${source.mode}`;
    if (sources.has(key)) throw new Error("Duplicate authoritative source");
    sources.set(key, source);
  }
  const snapshots = new Map<string, SearchSnapshot>();
  function sourceFor(b: AccessBinding): BankingDataSource {
    const source = sources.get(`${b.account.provider}:${b.account.mode}`);
    // Only the implemented synthetic adapter is supported in this delivery.
    if (
      !source ||
      b.account.provider !== "fixture" ||
      b.account.mode !== "fixture"
    )
      fail("UNSUPPORTED_CAPABILITY");
    return source;
  }
  async function validateTransaction(
    raw: unknown,
    b: AccessBinding,
  ): Promise<NormalizedTransaction> {
    const t = normalizeTransaction(raw),
      a = b.account;
    if (
      t.tenantId !== a.tenantId ||
      t.ownerId !== a.ownerId ||
      t.accountId !== a.accountId ||
      t.provenance.provider !== a.provider ||
      t.provenance.mode !== a.mode ||
      t.provenance.consentId !== b.consent.id ||
      t.simulated !== a.simulated
    )
      fail("INVALID_PROVIDER_DATA");
    if (t.reversalOfId) {
      const original = await repository.getTransaction(
        { tenantId: a.tenantId, actorId: a.ownerId },
        a.accountId,
        t.reversalOfId,
      );
      if (
        !original ||
        original.direction !== "debit" ||
        original.status !== "reversed" ||
        original.amountKobo !== t.amountKobo ||
        original.reversalOfId
      )
        fail("INVALID_PROVIDER_DATA");
    }
    return t;
  }
  async function run(
    ctxInput: PermissionContext,
    input: unknown,
  ): Promise<ToolResult<ToolData[ToolName]>> {
    const deadline = Date.now() + timeoutMs;
    let pendingSnapshot: SearchSnapshot | undefined;
    let searchExpires: number | undefined;
    let callId = "invalid-call";
    const baseMeta: ToolResult<unknown>["meta"] = {
      resultId: randomUUID(),
      asOf: trustedNow(clock),
      coverage: null,
      simulated: false,
      sources: [],
      truncated: false,
      nextCursor: null,
      warnings: [],
    };
    try {
      const parsed = ToolCallSchema.safeParse(input);
      if (!parsed.success) fail("INVALID_ARGUMENT");
      const call = parsed.data;
      callId = call.callId;
      const ctx = auth.context(ctxInput),
        scopes = scopesFor(call.name);
      const accountIds =
        "accountIds" in call.args
          ? call.args.accountIds
          : [call.args.accountId];
      const hide =
        call.name === "get_transaction" ||
        call.name === "find_payment_evidence";
      const bindings = await auth.bind(ctx, accountIds, scopes, hide);
      const revision = await repository.getRevision(ctx, accountIds);
      const check = async () => {
        if (Date.now() >= deadline) fail("TIMEOUT");
        await auth.recheck(ctx, bindings, scopes);
        if (revision !== (await repository.getRevision(ctx, accountIds)))
          fail("SNAPSHOT_EXPIRED");
        if (Date.now() >= deadline) fail("TIMEOUT");
      };
      async function io<T>(operation: () => Promise<T>): Promise<T> {
        await check();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([
            operation(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new FinancialDataError("TIMEOUT")),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
          await check();
          return value;
        } finally {
          clearTimeout(timer);
        }
      }
      baseMeta.simulated = bindings.every((b) => b.account.simulated);
      baseMeta.sources = [
        ...new Map(
          bindings.map((b) => [
            `${b.account.provider}:${b.account.mode}`,
            { provider: b.account.provider, mode: b.account.mode },
          ]),
        ).values(),
      ];
      if (baseMeta.simulated) baseMeta.warnings.push("FICTIONAL_DATA_ONLY");
      const result = (
        data: ToolData[ToolName],
        outcome: "ok" | "empty" | "partial" = "ok",
      ): ToolResult<ToolData[ToolName]> => ({
        protocolVersion: 1,
        callId,
        outcome,
        data,
        error: null,
        meta: baseMeta,
      });
      async function gather(f: ReadFilter) {
        const rows = new Map<string, NormalizedTransaction>(),
          ids = new Map<string, string>();
        const coverage: Coverage[] = [];
        let pageCount = 0,
          recordCount = 0;
        for (const b of bindings) {
          const source = sourceFor(b),
            seen = new Set<string>();
          let cursor: string | null = null,
            firstCoverage: Coverage | undefined;
          do {
            if (++pageCount > 100) fail("LIMIT_EXCEEDED");
            const page = parseProvider(
              pageSchema,
              await io(() =>
                source.getTransactions(ctx, b.consent.id, {
                  accountIds: [b.account.accountId],
                  from: f.from,
                  toExclusive: f.toExclusive,
                  limit: 50,
                  cursor,
                }),
              ),
            );
            recordCount += page.items.length;
            if (recordCount > 5000) fail("LIMIT_EXCEEDED");
            if (
              Date.parse(page.coverage.from) !== Date.parse(f.from) ||
              Date.parse(page.coverage.toExclusive) !==
                Date.parse(f.toExclusive) ||
              page.coverage.missingAccountIds.some(
                (id) => id !== b.account.accountId,
              )
            )
              fail("INVALID_PROVIDER_DATA");
            if (
              firstCoverage &&
              fingerprint(firstCoverage) !== fingerprint(page.coverage)
            )
              fail("SNAPSHOT_EXPIRED");
            firstCoverage ??= page.coverage;
            let added = 0;
            for (const raw of page.items) {
              const t = await validateTransaction(raw, b),
                at = transactionTime(t);
              if (
                at &&
                (Date.parse(at) < Date.parse(f.from) ||
                  Date.parse(at) >= Date.parse(f.toExclusive))
              )
                fail("INVALID_PROVIDER_DATA");
              const key = JSON.stringify([
                t.tenantId,
                t.ownerId,
                t.accountId,
                t.provenance.provider,
                t.provenance.mode,
                t.provenance.providerTransactionId,
              ]);
              const idKey = JSON.stringify([t.accountId, t.id]);
              if (ids.has(idKey) && ids.get(idKey) !== key)
                fail("INVALID_PROVIDER_DATA");
              ids.set(idKey, key);
              const previous = rows.get(key);
              if (previous && fingerprint(previous) !== fingerprint(t))
                fail("SNAPSHOT_EXPIRED");
              if (!previous) {
                rows.set(key, t);
                added++;
              }
            }
            if (
              page.nextCursor &&
              (!added ||
                seen.has(page.nextCursor) ||
                page.nextCursor === cursor)
            )
              fail("CURSOR_INVALID");
            if (page.nextCursor) seen.add(page.nextCursor);
            cursor = page.nextCursor;
          } while (cursor);
          coverage.push(firstCoverage!);
        }
        const combined = mergeCoverage(coverage, f);
        const undated = [...rows.values()].filter(
          (t) => transactionTime(t) === null,
        ).length;
        if (undated > combined.undatedCount) {
          combined.undatedCount = undated;
          combined.state = "partial";
          if (!combined.reasons.includes("UNDATED_RECORDS"))
            combined.reasons.push("UNDATED_RECORDS");
        }
        return { rows: [...rows.values()], coverage: combined };
      }
      let answer: ToolResult<ToolData[ToolName]>;
      switch (call.name) {
        case "search_transactions": {
          const f = call.args,
            queryHash = fingerprint({ ...f, cursor: null }),
            principal = fingerprint([ctx.tenantId, ctx.actorId]);
          let snapshot: SearchSnapshot;
          if (f.cursor) {
            const cached = snapshots.get(f.cursor);
            if (
              !cached ||
              cached.principal !== principal ||
              cached.query !== queryHash
            )
              fail("CURSOR_INVALID");
            if (
              cached.expires <= Date.parse(trustedNow(clock)) ||
              cached.revision !== revision
            ) {
              snapshots.delete(f.cursor);
              fail("SNAPSHOT_EXPIRED");
            }
            // Claim synchronously before any further await: concurrent reuse fails closed.
            snapshots.delete(f.cursor);
            snapshot = cached;
          } else {
            const all = await gather(f),
              tokens = tokenize(f.query);
            const rows = all.rows.filter(
              (t) =>
                matchesFilter(t, f, true) &&
                tokens.every((token) => t.search.tokens.includes(token)),
            );
            const ranks = {
              exact_reference: 0,
              exact_counterparty: 1,
              token_match: 2,
              filter_match: 3,
            };
            rows.sort(
              (a, b) =>
                ranks[rank(a, f.query)!] - ranks[rank(b, f.query)!] ||
                Date.parse(transactionTime(b)!) -
                  Date.parse(transactionTime(a)!) ||
                (a.id < b.id
                  ? -1
                  : a.id > b.id
                    ? 1
                    : a.accountId.localeCompare(b.accountId)),
            );
            snapshot = {
              principal,
              query: queryHash,
              revision,
              expires: Date.parse(trustedNow(clock)) + 900000,
              rows,
              offset: 0,
              coverage: all.coverage,
            };
          }
          searchExpires = snapshot.expires;
          baseMeta.coverage = snapshot.coverage;
          const matches = snapshot.rows
            .slice(snapshot.offset, snapshot.offset + f.limit)
            .map((t) =>
              view(
                t,
                bindings.find((b) => b.account.accountId === t.accountId)!
                  .account,
                f.query,
              ),
            );
          const data: ToolData["search_transactions"] = {
            matches,
            appliedFilters: f,
            hasMore: false,
            matchCount: snapshot.rows.length,
            selection:
              snapshot.rows.length === 0
                ? "none"
                : snapshot.rows.length === 1
                  ? "single_candidate"
                  : "ambiguous",
          };
          // Keep the complete candidate set in the private snapshot; disclose only a bounded page.
          while (matches.length && byteSize(result(data)) > 15000) {
            matches.pop();
            baseMeta.truncated = true;
          }
          if (snapshot.rows.length > snapshot.offset && matches.length === 0)
            fail("LIMIT_EXCEEDED");
          data.hasMore =
            snapshot.offset + matches.length < snapshot.rows.length;
          if (data.hasMore) {
            baseMeta.nextCursor = randomUUID();
            pendingSnapshot = {
              ...snapshot,
              offset: snapshot.offset + matches.length,
            };
          }
          if (data.selection === "ambiguous")
            baseMeta.warnings.push("SELECTION_REQUIRED");
          if (data.selection === "none")
            baseMeta.warnings.push("REFINE_SEARCH_NOT_PROOF_OF_ABSENCE");
          answer = result(
            data,
            snapshot.coverage.state !== "complete"
              ? "partial"
              : matches.length
                ? "ok"
                : "empty",
          );
          break;
        }
        case "calculate_spending": {
          const f = call.args,
            all = await gather(f);
          baseMeta.coverage = all.coverage;
          if (
            all.coverage.state === "unknown" ||
            all.coverage.missingAccountIds.length
          )
            fail("PROVIDER_UNAVAILABLE");
          const excluded = {
            pending: 0,
            failed: 0,
            reversed: 0,
            unknown: 0,
            reversal: 0,
            undated: all.coverage.undatedCount,
          };
          const totals = {
            expenseKobo: 0,
            incomeKobo: 0,
            netKobo: 0,
            includedCount: 0,
          };
          const groups = new Map<string, typeof totals>();
          for (const t of all.rows) {
            if (!matchesFilter(t, f, false)) continue;
            if (t.status !== "posted") {
              excluded[t.status]++;
              continue;
            }
            if (t.reversalOfId) {
              excluded.reversal++;
              continue;
            }
            const key = groupKey(t, f.groupBy),
              group = groups.get(key) ?? {
                expenseKobo: 0,
                incomeKobo: 0,
                netKobo: 0,
                includedCount: 0,
              };
            for (const target of [totals, group]) {
              const field =
                t.direction === "debit" ? "expenseKobo" : "incomeKobo";
              target[field] = safeAdd(target[field], t.amountKobo);
              target.includedCount++;
              target.netKobo = safeAdd(target.incomeKobo, -target.expenseKobo);
            }
            groups.set(key, group);
            if (groups.size > 1000) fail("LIMIT_EXCEEDED");
          }
          answer = result(
            {
              ...totals,
              calculationId: randomUUID(),
              currency: "NGN",
              timezone: "Africa/Lagos",
              appliedFilters: f,
              coverage: all.coverage,
              excluded,
              groups: [...groups]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, values]) => ({ key, ...values })),
            },
            all.coverage.state !== "complete" ? "partial" : "ok",
          );
          if (all.coverage.state !== "complete")
            baseMeta.warnings.push("AVAILABLE_RECORDS_ONLY");
          break;
        }
        case "get_transaction": {
          const b = bindings[0],
            t = await io(() =>
              sourceFor(b).getTransaction(
                ctx,
                b.consent.id,
                call.args.accountId,
                call.args.transactionId,
              ),
            );
          if (!t) fail("NOT_FOUND");
          const validated = await validateTransaction(t, b);
          if (validated.id !== call.args.transactionId)
            fail("INVALID_PROVIDER_DATA");
          answer = result(view(validated, b.account));
          break;
        }
        case "find_payment_evidence": {
          const b = bindings[0],
            source = sourceFor(b);
          const raw = await io(() =>
            source.getTransaction(
              ctx,
              b.consent.id,
              call.args.accountId,
              call.args.transactionId,
            ),
          );
          if (!raw) fail("NOT_FOUND");
          const t = await validateTransaction(raw, b);
          if (t.id !== call.args.transactionId) fail("INVALID_PROVIDER_DATA");
          const rows = await io(() =>
            source.getEvidence(
              ctx,
              b.consent.id,
              call.args.accountId,
              call.args.transactionId,
            ),
          );
          if (!Array.isArray(rows) || rows.length > 10)
            fail("INVALID_PROVIDER_DATA");
          const seen = new Set<string>();
          const evidence = rows.map((raw) => {
            const e = parseProvider(EvidenceRecordSchema, raw);
            if (
              e.tenantId !== ctx.tenantId ||
              e.ownerId !== ctx.actorId ||
              e.accountId !== b.account.accountId ||
              e.transactionId !== t.id ||
              !t.evidenceIds.includes(e.id) ||
              e.provider !== b.account.provider ||
              e.mode !== b.account.mode ||
              e.simulated !== b.account.simulated ||
              seen.has(e.id)
            )
              fail("INVALID_PROVIDER_DATA");
            seen.add(e.id);
            const {
              artifactRef: _artifact,
              sha256: _hash,
              tenantId: _tenant,
              ownerId: _owner,
              accountId: _account,
              ...safe
            } = e;
            return safe;
          });
          if (!evidence.length) baseMeta.warnings.push("NO_AVAILABLE_EVIDENCE");
          answer = result({ evidence }, evidence.length ? "ok" : "empty");
          break;
        }
        case "get_account_summary": {
          const accounts: ToolData["get_account_summary"]["accounts"] = [];
          for (const b of bindings) {
            const summary = parseProvider(
              AccountSummarySchema,
              await io(() =>
                sourceFor(b).getAccountSummary(
                  ctx,
                  b.consent.id,
                  b.account.accountId,
                ),
              ),
            );
            if (
              summary.accountId !== b.account.accountId ||
              summary.simulated !== b.account.simulated
            )
              fail("INVALID_PROVIDER_DATA");
            if (
              summary.asOf &&
              Date.parse(summary.asOf) > Date.parse(trustedNow(clock))
            )
              fail("INVALID_PROVIDER_DATA");
            const stale =
              summary.asOf !== null &&
              Date.parse(trustedNow(clock)) - Date.parse(summary.asOf) >
                86400000;
            const safeSummary =
              stale || summary.unavailableReason === "stale"
                ? {
                    ...summary,
                    availableKobo: null,
                    currentKobo: null,
                    unavailableReason: "stale" as const,
                  }
                : summary;
            accounts.push({
              ...safeSummary,
              source: { provider: b.account.provider, mode: b.account.mode },
              lastSyncedAt: b.account.lastSyncedAt,
            });
          }
          const missing = accounts.some(
            (a) =>
              a.availableKobo === null ||
              a.currentKobo === null ||
              a.unavailableReason !== null,
          );
          if (missing) baseMeta.warnings.push("BALANCE_UNAVAILABLE");
          answer = result({ accounts }, missing ? "partial" : "ok");
          break;
        }
      }
      await check();
      if (
        !ToolDataSchemas[call.name].safeParse(answer.data).success ||
        !toolResultSchema(call.name).safeParse(answer).success
      )
        fail("INVALID_PROVIDER_DATA");
      if (byteSize(answer) > 16384) fail("LIMIT_EXCEEDED");
      const now = Date.parse(trustedNow(clock));
      if (searchExpires !== undefined && searchExpires <= now)
        fail("SNAPSHOT_EXPIRED");
      // Publish only after authorization, revision and result checks all succeed.
      if (pendingSnapshot) {
        for (const [token, s] of snapshots)
          if (s.expires <= now) snapshots.delete(token);
        if (snapshots.size >= 100) fail("LIMIT_EXCEEDED");
        snapshots.set(baseMeta.nextCursor!, pendingSnapshot);
      }
      return structuredClone(answer);
    } catch (error) {
      const code =
        error instanceof FinancialDataError
          ? error.code
          : error instanceof z.ZodError
            ? "INVALID_ARGUMENT"
            : "PROVIDER_UNAVAILABLE";
      return {
        protocolVersion: 1,
        callId,
        outcome: "error",
        data: null,
        error: {
          code,
          retryable: code === "PROVIDER_UNAVAILABLE" || code === "TIMEOUT",
        },
        meta: {
          ...baseMeta,
          coverage: null,
          nextCursor: null,
          truncated: false,
          sources: [],
          simulated: false,
          warnings: [],
        },
      };
    }
  }
  // Bound repository authorization as well as provider I/O; a stalled resolver must not hang the caller.
  async function bounded(
    ctx: PermissionContext,
    input: unknown,
  ): Promise<ToolResult<ToolData[ToolName]>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const parsed = ToolCallSchema.safeParse(input);
    try {
      return await Promise.race([
        run(ctx, input),
        new Promise<ToolResult<ToolData[ToolName]>>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                protocolVersion: 1,
                callId: parsed.success ? parsed.data.callId : "invalid-call",
                outcome: "error",
                data: null,
                error: { code: "TIMEOUT", retryable: true },
                meta: {
                  resultId: randomUUID(),
                  asOf: trustedNow(clock),
                  coverage: null,
                  simulated: false,
                  sources: [],
                  truncated: false,
                  nextCursor: null,
                  warnings: [],
                },
              }),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    dispatch: bounded,
    execute: <K extends ToolName>(ctx: PermissionContext, call: ToolCall<K>) =>
      bounded(ctx, call) as Promise<ToolResult<ToolData[K]>>,
  });
}
