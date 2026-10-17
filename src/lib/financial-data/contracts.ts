/** Provisional v1: founder/Gerald review is required before cross-workstream adoption. */
import { z } from "zod";

export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const InstantSchema = z.iso
  .datetime({ precision: undefined })
  .refine((s) => Number.isFinite(Date.parse(s)), "Invalid UTC instant");
export const KoboSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const SignedKoboSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const ProviderSchema = z.enum([
  "fixture",
  "wema",
  "mono",
  "paystack_projection",
]);
export const DataModeSchema = z.enum(["fixture", "sandbox", "live"]);
export const ScopeSchema = z.enum([
  "accounts:read",
  "transactions:read",
  "evidence:read",
]);
export const StatusSchema = z.enum([
  "pending",
  "posted",
  "failed",
  "reversed",
  "unknown",
]);
const text = (max: number) => z.string().max(max);
const uniqueIds = (max: number) =>
  z
    .array(IdSchema)
    .min(1)
    .max(max)
    .refine((a) => new Set(a).size === a.length, "Duplicate IDs");
const owner = { tenantId: IdSchema, ownerId: IdSchema, accountId: IdSchema };
const source = { provider: ProviderSchema, mode: DataModeSchema };
const markers = { ...source, simulated: z.boolean() };
const validMarkers = (v: {
  provider: string;
  mode: string;
  simulated: boolean;
}) =>
  v.provider === "fixture"
    ? v.mode === "fixture" && v.simulated
    : v.mode !== "fixture" && !v.simulated;
const intervalValid = (v: { from: string; toExclusive: string }) =>
  Date.parse(v.from) < Date.parse(v.toExclusive);
const boundedInterval = (v: { from: string; toExclusive: string }) =>
  intervalValid(v) &&
  Date.parse(v.toExclusive) - Date.parse(v.from) <= 366 * 86400000;
export const OwnershipSchema = z.strictObject(owner);
export const PermissionContextSchema = z.strictObject({
  tenantId: IdSchema,
  actorId: IdSchema,
  requestId: IdSchema,
  now: InstantSchema,
});
export const ConsentSchema = z
  .strictObject({
    id: IdSchema,
    tenantId: IdSchema,
    ownerId: IdSchema,
    ...source,
    accountIds: uniqueIds(100),
    scopes: z
      .array(ScopeSchema)
      .min(1)
      .max(3)
      .refine((a) => new Set(a).size === a.length),
    purpose: z.literal("financial_assistant"),
    state: z.enum(["active", "revoked", "expired"]),
    grantedAt: InstantSchema,
    expiresAt: InstantSchema,
    revokedAt: InstantSchema.nullable(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (v) =>
      Date.parse(v.grantedAt) < Date.parse(v.expiresAt) &&
      (v.state === "revoked"
        ? v.revokedAt !== null &&
          Date.parse(v.revokedAt) >= Date.parse(v.grantedAt)
        : v.revokedAt === null),
    "Invalid consent lifecycle",
  )
  .refine(
    (v) => (v.provider === "fixture") === (v.mode === "fixture"),
    "Invalid source/mode",
  );
export const AccountRecordSchema = z
  .strictObject({
    ...owner,
    ...markers,
    displayName: text(100).min(1),
    maskedNumber: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    currency: z.literal("NGN"),
    consentId: IdSchema,
    lastSyncedAt: InstantSchema.nullable(),
  })
  .refine(validMarkers, "Invalid simulation markers");
export const ProvenanceSchema = z.strictObject({
  ...source,
  providerTransactionId: IdSchema,
  providerAccountRef: IdSchema,
  consentId: IdSchema,
  fetchedAt: InstantSchema,
  rawRecordRef: IdSchema.nullable(),
  rawRecordSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  timestampBasis: z.enum(["provider", "fixture"]),
});
export const NormalizedTransactionSchema = z
  .strictObject({
    ...owner,
    schemaVersion: z.literal(1),
    id: IdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal("NGN"),
    amountKobo: KoboSchema.refine((v) => v > 0, "Zero-value monetary record"),
    direction: z.enum(["debit", "credit"]),
    status: StatusSchema,
    occurredAt: InstantSchema.nullable(),
    bookedAt: InstantSchema.nullable(),
    observedAt: InstantSchema,
    updatedAt: InstantSchema,
    counterparty: z.strictObject({
      displayName: text(100).nullable(),
      institution: text(100).nullable(),
    }),
    description: text(500),
    reference: text(128).nullable(),
    category: z
      .strictObject({
        value: text(50).min(1),
        source: z.enum(["fixture", "provider", "user"]),
      })
      .nullable(),
    search: z.strictObject({
      normalizedText: text(1500),
      tokens: z.array(text(500)).max(750),
      version: z.literal(1),
    }),
    provenance: ProvenanceSchema,
    evidenceIds: z
      .array(IdSchema)
      .max(10)
      .refine((a) => new Set(a).size === a.length),
    reversalOfId: IdSchema.nullable(),
    simulated: z.boolean(),
    simulationLabel: text(100).min(1).nullable(),
  })
  .refine(
    (v) =>
      validMarkers({ ...v.provenance, simulated: v.simulated }) &&
      (v.simulated
        ? v.simulationLabel !== null &&
          v.provenance.timestampBasis === "fixture"
        : v.simulationLabel === null &&
          v.provenance.timestampBasis === "provider"),
    "Invalid simulation provenance",
  )
  .refine(
    (v) =>
      v.reversalOfId !== v.id &&
      (v.reversalOfId === null || v.direction === "credit"),
    "Invalid reversal link",
  );
export const EvidenceRecordSchema = z
  .strictObject({
    ...owner,
    ...markers,
    id: IdSchema,
    transactionId: IdSchema,
    kind: z.enum([
      "synthetic_record",
      "provider_record",
      "transfer_verification",
      "receipt_attachment",
    ]),
    sourceReference: text(128).min(1),
    observedAt: InstantSchema,
    sourceStatus: text(100).nullable(),
    artifactRef: IdSchema.nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    limitations: z.array(text(200)).max(10),
  })
  .refine(validMarkers, "Invalid simulation markers")
  .refine(
    (v) =>
      v.simulated
        ? v.kind === "synthetic_record" && v.limitations.length > 0
        : v.kind !== "synthetic_record",
    "Invalid evidence kind",
  );
export const CoverageReasonSchema = z.enum([
  "UNDATED_RECORDS",
  "SOURCE_PARTIAL",
  "SOURCE_UNKNOWN",
  "MISSING_ACCOUNT",
  "NOT_SYNCED",
  "ZERO_VALUE_EXCLUDED",
]);
export const CoverageSchema = z
  .strictObject({
    from: InstantSchema,
    toExclusive: InstantSchema,
    state: z.enum(["complete", "partial", "unknown"]),
    missingAccountIds: z.array(IdSchema).max(5),
    undatedCount: KoboSchema,
    lastSyncedAt: InstantSchema.nullable(),
    reasons: z.array(CoverageReasonSchema).max(10),
  })
  .refine(intervalValid)
  .refine(
    (v) =>
      v.state !== "complete" ||
      (v.missingAccountIds.length === 0 &&
        v.undatedCount === 0 &&
        v.reasons.length === 0),
    "Incomplete coverage",
  );
export const HistoryQuerySchema = z
  .strictObject({
    accountIds: uniqueIds(5),
    from: InstantSchema,
    toExclusive: InstantSchema,
    cursor: text(256).min(1).nullable(),
    limit: z.number().int().min(1).max(50),
  })
  .refine(boundedInterval);
export const AccountSummarySchema = z
  .strictObject({
    accountId: IdSchema,
    currency: z.literal("NGN"),
    availableKobo: SignedKoboSchema.nullable(),
    currentKobo: SignedKoboSchema.nullable(),
    asOf: InstantSchema.nullable(),
    simulated: z.boolean(),
    unavailableReason: z.enum(["not_provided", "stale"]).nullable(),
  })
  .refine(
    (v) =>
      v.unavailableReason === null
        ? v.availableKobo !== null && v.currentKobo !== null && v.asOf !== null
        : true,
    "Missing balance reason",
  );
const filterShape = {
  accountIds: uniqueIds(5),
  from: InstantSchema,
  toExclusive: InstantSchema,
  direction: z.enum(["debit", "credit"]).optional(),
  statuses: z
    .array(StatusSchema)
    .min(1)
    .max(5)
    .refine((a) => new Set(a).size === a.length)
    .optional(),
  category: text(50).min(1).optional(),
  amountKobo: z
    .strictObject({ min: KoboSchema, max: KoboSchema })
    .refine((v) => v.min <= v.max)
    .optional(),
};
export const ReadFilterSchema = z
  .strictObject(filterShape)
  .refine(boundedInterval);
const selection = { accountId: IdSchema, transactionId: IdSchema };
export const ToolArgsSchemas = {
  search_transactions: z
    .strictObject({
      ...filterShape,
      query: text(200),
      limit: z.number().int().min(1).max(25).default(10),
      cursor: text(128).min(1).nullable(),
    })
    .refine(boundedInterval),
  get_transaction: z.strictObject(selection),
  calculate_spending: z
    .strictObject({
      ...filterShape,
      groupBy: z.enum(["none", "category", "week", "month"]),
    })
    .refine(boundedInterval)
    .refine(
      (v) => !v.statuses || v.statuses.every((s) => s === "posted"),
      "Calculations require posted status",
    ),
  find_payment_evidence: z.strictObject(selection),
  get_account_summary: z.strictObject({ accountIds: uniqueIds(5) }),
} as const;
export type ToolName = keyof typeof ToolArgsSchemas;
export type ToolArgs = {
  [K in ToolName]: z.infer<(typeof ToolArgsSchemas)[K]>;
};
export type ToolCall<K extends ToolName = ToolName> = {
  [N in K]: { protocolVersion: 1; callId: string; name: N; args: ToolArgs[N] };
}[K];
const callFields = { protocolVersion: z.literal(1), callId: IdSchema.max(64) };
export const ToolCallSchema = z.discriminatedUnion("name", [
  z.strictObject({
    ...callFields,
    name: z.literal("search_transactions"),
    args: ToolArgsSchemas.search_transactions,
  }),
  z.strictObject({
    ...callFields,
    name: z.literal("get_transaction"),
    args: ToolArgsSchemas.get_transaction,
  }),
  z.strictObject({
    ...callFields,
    name: z.literal("calculate_spending"),
    args: ToolArgsSchemas.calculate_spending,
  }),
  z.strictObject({
    ...callFields,
    name: z.literal("find_payment_evidence"),
    args: ToolArgsSchemas.find_payment_evidence,
  }),
  z.strictObject({
    ...callFields,
    name: z.literal("get_account_summary"),
    args: ToolArgsSchemas.get_account_summary,
  }),
]);
export const ToolErrorCodeSchema = z.enum([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "CONSENT_REQUIRED",
  "CONSENT_EXPIRED",
  "CONSENT_REVOKED",
  "UNSUPPORTED_CAPABILITY",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "CURSOR_INVALID",
  "SNAPSHOT_EXPIRED",
  "LIMIT_EXCEEDED",
  "INVALID_PROVIDER_DATA",
  "CURRENCY_MISMATCH",
  "ARITHMETIC_OVERFLOW",
]);
export const SafeSourceSchema = z.strictObject(source);
export const TransactionViewSchema = z.strictObject({
  id: IdSchema,
  accountId: IdSchema,
  accountLabel: text(110),
  revision: z.number().int().positive(),
  currency: z.literal("NGN"),
  amountKobo: KoboSchema,
  direction: z.enum(["debit", "credit"]),
  status: StatusSchema,
  occurredAt: InstantSchema.nullable(),
  bookedAt: InstantSchema.nullable(),
  dateBasis: z.enum(["bookedAt", "occurredAt", "unknown"]),
  counterparty: z.strictObject({
    displayName: text(100).nullable(),
    institution: text(100).nullable(),
  }),
  description: text(500),
  reference: text(128).nullable(),
  category: z
    .strictObject({
      value: text(50),
      source: z.enum(["fixture", "provider", "user"]),
    })
    .nullable(),
  simulated: z.boolean(),
  simulationLabel: text(100).nullable(),
  source: SafeSourceSchema,
  evidenceIds: z.array(IdSchema).max(10),
  rankReason: z
    .enum([
      "exact_reference",
      "exact_counterparty",
      "token_match",
      "filter_match",
    ])
    .nullable(),
});
export const EvidenceViewSchema = z.strictObject({
  id: IdSchema,
  transactionId: IdSchema,
  kind: EvidenceRecordSchema.shape.kind,
  provider: ProviderSchema,
  mode: DataModeSchema,
  sourceReference: text(128),
  observedAt: InstantSchema,
  sourceStatus: text(100).nullable(),
  limitations: z.array(text(200)).max(10),
  simulated: z.boolean(),
});
const totalsShape = {
  expenseKobo: KoboSchema,
  incomeKobo: KoboSchema,
  netKobo: SignedKoboSchema,
  includedCount: KoboSchema,
};
export const CalculationSchema = z.strictObject({
  ...totalsShape,
  calculationId: IdSchema,
  currency: z.literal("NGN"),
  timezone: z.literal("Africa/Lagos"),
  appliedFilters: ToolArgsSchemas.calculate_spending,
  coverage: CoverageSchema,
  excluded: z.strictObject({
    pending: KoboSchema,
    failed: KoboSchema,
    reversed: KoboSchema,
    unknown: KoboSchema,
    reversal: KoboSchema,
    undated: KoboSchema,
  }),
  groups: z.array(z.strictObject({ key: text(50), ...totalsShape })).max(1000),
});
export const ToolDataSchemas = {
  search_transactions: z.strictObject({
    matches: z.array(TransactionViewSchema).max(25),
    appliedFilters: ToolArgsSchemas.search_transactions,
    hasMore: z.boolean(),
    matchCount: KoboSchema,
    selection: z.enum(["none", "single_candidate", "ambiguous"]),
  }),
  get_transaction: TransactionViewSchema,
  calculate_spending: CalculationSchema,
  find_payment_evidence: z.strictObject({
    evidence: z.array(EvidenceViewSchema).max(10),
  }),
  get_account_summary: z.strictObject({
    accounts: z
      .array(
        AccountSummarySchema.safeExtend({
          source: SafeSourceSchema,
          lastSyncedAt: InstantSchema.nullable(),
        }),
      )
      .max(5),
  }),
} as const;
export type ToolData = {
  [K in ToolName]: z.infer<(typeof ToolDataSchemas)[K]>;
};
export const ResultMetaSchema = z.strictObject({
  resultId: IdSchema,
  asOf: InstantSchema,
  coverage: CoverageSchema.nullable(),
  simulated: z.boolean(),
  sources: z.array(SafeSourceSchema).max(5),
  truncated: z.boolean(),
  nextCursor: text(128).nullable(),
  warnings: z.array(text(100)).max(20),
});
export function toolResultSchema<K extends ToolName>(name: K) {
  return z
    .strictObject({
      protocolVersion: z.literal(1),
      callId: IdSchema.max(64),
      outcome: z.enum(["ok", "empty", "partial", "error"]),
      data: ToolDataSchemas[name].nullable(),
      error: z
        .strictObject({ code: ToolErrorCodeSchema, retryable: z.boolean() })
        .nullable(),
      meta: ResultMetaSchema,
    })
    .refine(
      (v) =>
        v.outcome === "error"
          ? v.data === null && v.error !== null
          : v.data !== null && v.error === null,
      "Invalid result envelope",
    );
}
export type Provider = z.infer<typeof ProviderSchema>;
export type DataMode = z.infer<typeof DataModeSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Ownership = z.infer<typeof OwnershipSchema>;
export type PermissionContext = z.infer<typeof PermissionContextSchema>;
export type Consent = z.infer<typeof ConsentSchema>;
export type AccountRecord = z.infer<typeof AccountRecordSchema>;
export type NormalizedTransaction = z.infer<typeof NormalizedTransactionSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export type ReadFilter = z.infer<typeof ReadFilterSchema>;
export type TransactionView = z.infer<typeof TransactionViewSchema>;
export type EvidenceView = z.infer<typeof EvidenceViewSchema>;
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;
export type ToolResult<T> = {
  protocolVersion: 1;
  callId: string;
  outcome: "ok" | "empty" | "partial" | "error";
  data: T | null;
  error: { code: ToolErrorCode; retryable: boolean } | null;
  meta: z.infer<typeof ResultMetaSchema>;
};
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  coverage: Coverage;
};
export interface BankingDataSource {
  readonly provider: Provider;
  readonly mode: DataMode;
  listAccounts(
    ctx: PermissionContext,
    consentId: string,
  ): Promise<AccountRecord[]>;
  getTransactions(
    ctx: PermissionContext,
    consentId: string,
    query: HistoryQuery,
  ): Promise<Page<NormalizedTransaction>>;
  getTransaction(
    ctx: PermissionContext,
    consentId: string,
    accountId: string,
    transactionId: string,
  ): Promise<NormalizedTransaction | null>;
  getEvidence(
    ctx: PermissionContext,
    consentId: string,
    accountId: string,
    transactionId: string,
  ): Promise<EvidenceRecord[]>;
  getAccountSummary(
    ctx: PermissionContext,
    consentId: string,
    accountId: string,
  ): Promise<AccountSummary>;
  revokeConsent(ctx: PermissionContext, consentId: string): Promise<void>;
}
/** Server-only. No repository, consent administration or provider cursor is passed to the model. */
export type Principal = Pick<PermissionContext, "tenantId" | "actorId">;
export interface FinancialRepository {
  getConsent(principal: Principal, id: string): Promise<Consent | null>;
  getAccount(principal: Principal, id: string): Promise<AccountRecord | null>;
  listAccounts(
    principal: Principal,
    consentId: string,
  ): Promise<AccountRecord[]>;
  listTransactions(
    principal: Principal,
    accountId: string,
  ): Promise<NormalizedTransaction[]>;
  getTransaction(
    principal: Principal,
    accountId: string,
    id: string,
  ): Promise<NormalizedTransaction | null>;
  getEvidence(
    principal: Principal,
    accountId: string,
    transactionId: string,
  ): Promise<EvidenceRecord[]>;
  getAccountSummary(
    principal: Principal,
    accountId: string,
  ): Promise<AccountSummary | null>;
  /** Changes on ingestion, deletion or consent changes; stable across unchanged reads. */
  getRevision(principal: Principal, accountIds: string[]): Promise<string>;
  revokeConsent(principal: Principal, id: string, now: string): Promise<void>;
}
export type ReadToolDispatcher = {
  execute<K extends ToolName>(
    ctx: PermissionContext,
    call: ToolCall<K>,
  ): Promise<ToolResult<ToolData[K]>>;
  dispatch(
    ctx: PermissionContext,
    untrustedCall: unknown,
  ): Promise<ToolResult<ToolData[ToolName]>>;
};
