# Agent A — provisional financial-memory v1 handoff

Status: standalone implementation for founder/Gerald review. **Contracts remain
PROVISIONAL; no integration, release or real-data approval is implied.**

## Branch and immutable references

- Repository: `omnmlr/hackaholics-financial-agent`.
- Branch: `feat/agus-financial-data`.
- Exact base: `45f553177f86c2a40de6885304ed9bd47a5af5de`.
- Target: `docs/agus-phase1-foundation-20261017` (Phase 1 PR #13).
- Contract-only commit: **`e9041da4c71be5316f382f9d987624cd7aff9966`**.
  `src/lib/financial-data/contracts.ts` remains unchanged after that commit.
  Initial proposal `e37a13708006ab2a3001a93e87c9dc744385f933` is its parent; the
  final contract-only amendment rejects sub-millisecond timestamps before date
  arithmetic can truncate them. Neither proposal is recorded as approved.
- Worktree: `/workspace/agus-financial-data`; the original checkout and Gerald's
  branch are unchanged. The implementation commit is the commit adding this handoff;
  subsequent documentation-only verification updates do not amend the contract.

Read all four requested Phase 1 documents before implementation. GitHub inspection
found no approved newer `integration/agus-financial-memory` base. The docs branch and
main still pointed to the specified docs commit and its parent respectively. Shell
Git initially could not reach the proxy inside the default sandbox. The connected
GitHub API supplied the five Phase 1 files and unsigned commit metadata; all file,
tree and commit hashes matched the reference exactly when materialized locally.
Subsequent Git fetch/push with the supported network permission succeeded. No existing
branch was reset or force-pushed.

The user's Goal A expressly authorizes isolated implementation against provisional
contracts. This supersedes Phase 1's launch prerequisite for this workstream only;
G0 baseline repairs, shared contract acceptance and integration remain Gerald/founder
work. No one has been contacted or recorded as approving these contracts.

## Delivered boundary and exports

Only `src/lib/financial-data/**`, `tests/financial-data/**`, and this document change.
No routes, dependency/lock files, migrations, global ledger, payment engine, auth,
configuration, orchestration or UI change. All module imports stay inside the new
namespace, Zod and Node built-ins. This module is server-only and must never be
bundled into a client component.

Import types and schemas from `@/lib/financial-data/contracts`. The module barrel
`@/lib/financial-data` additionally exports factories and administrative fixture helpers.

| Export                                                                                                                                                                                    | Purpose / trust boundary                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ownership`, `PermissionContext`, `Principal`, `Consent`, `AccountRecord`, `NormalizedTransaction`, `EvidenceRecord`, `Coverage`, `AccountSummary` and corresponding `*Schema` validators | Strict v1 storage contracts. Explicit nulls; NGN and UTC instants; bounded strings, IDs, safe integer magnitudes and provenance.                                                                                                   |
| `ToolArgs`, `ToolName`, mapped `ToolCall<K>`, `ToolCallSchema`, `ToolArgsSchemas`                                                                                                         | Name/args remain correlated in TypeScript and at runtime. Model arguments cannot contain principal, consent or mode.                                                                                                               |
| `TransactionView`, `EvidenceView`, `ToolData`, `ToolDataSchemas`, `ToolResult<T>`, `toolResultSchema(name)`                                                                               | Sanitized, typed results for B's fake tools, renderer and fact catalogue.                                                                                                                                                          |
| `BankingDataSource`, `Page<T>`, `HistoryQuery`, `FinancialRepository`                                                                                                                     | Async, scoped, injected server interfaces. Repository is deliberately unavailable to model code.                                                                                                                                   |
| `ReadToolDispatcher`, `createReadTools`, `READ_TOOL_REGISTRY`                                                                                                                             | Exactly five validated read operations; typed `execute(ctx, call)` and untrusted-input `dispatch(ctx, unknown)`. No registry administration or payment operations.                                                                 |
| `MemoryFinancialRepository`, `FixtureDatasetSchema`, `FixtureDataset`                                                                                                                     | In-memory read model and synthetic dataset contract; constructing the repository also validates composite foreign keys and duplicate/reversal/source links. Dataset schema validation alone cannot establish relational integrity. |
| `createFixtureDataset`, `createFixtureRepository`, `createFixtureDataSource`                                                                                                              | Fixed synthetic histories and independently permission-checked fixture adapter. No provider selection/fallback from names.                                                                                                         |
| `FIXTURE_SEED`, `FIXTURE_NOW`, `FIXTURE_LABEL`, `FIXTURE_EXPECTED_OCTOBER`, `fixturePrincipal`, `fixtureOtherPrincipal`                                                                   | Explicitly fictional reproducibility manifest; demonstration principals are not authenticated identities.                                                                                                                          |
| `normalizeText`, `tokenize`, `normalizeTransaction`, `signedFixtureAmount`, `safeAdd`, `lagosDateInterval`, `FinancialDataError`                                                          | Deterministic normalization, signed synthetic conversion, safe arithmetic, explicit Lagos date intervals and bounded errors.                                                                                                       |

`FinancialRepository` exposes scoped reads, revision tracking and server administration
`revokeConsent`; it does not expose ingestion through its interface. The concrete
memory repository's `ingestTransactions(unknown[])` is a server administrative helper,
never a model tool. Changes validate atomically. Identical duplicates are idempotent;
higher revisions replace the same scoped provider identity, stale/conflicting
revisions or changed identity fail. Zero monetary records are omitted with
`ZERO_VALUE_EXCLUDED` after validating their other fields.

### Tool behavior

- `search_transactions`: strict account/date/direction/status/category/amount filters,
  NFKC/lowercase Unicode AND-token search over name, description and reference;
  exact reference/name ranks, then transaction time descending and ID ascending.
  Returns applied filters, ranks, match count and `none` / `single_candidate` /
  `ambiguous`. One displayed row can still be ambiguous. A candidate does not prove
  payment or recipient credit. Zero matches invite refinement, not a claim of absence.
- `get_transaction`: sanitized details, record revision, date basis, safe source and
  evidence IDs. Cross-owner and absent individual IDs return `NOT_FOUND`.
- `calculate_spending`: authoritative integer-kobo expense, income, net and grouped
  totals over **all** provider pages. Posted debits/credits only; non-posted statuses,
  undated records and linked reversal credits excluded and counted. Original reversed
  debits remain excluded. Debit/credit/category/amount filters are displayed. Dates
  are half-open UTC instants; week/month grouping uses Africa/Lagos, Monday weeks.
  Partial coverage says `AVAILABLE_RECORDS_ONLY`; unknown coverage/missing accounts,
  overflow or exhausted budgets return errors with no arithmetic payload.
- `find_payment_evidence`: up to ten safe evidence views, without artifact/raw-store
  references or hashes. All fixture evidence is synthetic with limitations. Missing
  evidence returns `empty`, not an invented receipt.
- `get_account_summary`: up to five summaries, sources, sync times and explicit null
  balances. Known signed balances are allowed; missing balances never become zero
  or a transaction sum. Balances over 24 hours old are withheld as `stale`.

Every account is bound to one authoritative source and one active consent. The
current permission design allows only `ctx.actorId === ownerId` in the same tenant;
there is **no delegation or business-role inference**. Server-owned context, accounts
and consent bindings authorize each request, before provider/cache reads and again
before disclosure. Fixture adapter independently repeats those checks. Both
transaction/evidence scopes are required for evidence; scopes never imply each other.
Expiry uses the injected server clock, overriding `ctx.now`. Consent revocation/version
changes and relevant record changes suppress in-flight results and invalidate cursors.

Server-issued search cursors are random references to private 15-minute snapshots,
bound to principal, exact parsed filters/page size, consent/account/data revision and
ordering. Fixture-provider cursors are separate opaque server-side references and
never enter tool output. No model-visible URL is fetched. Cycles/no progress,
conflicting duplicates, schema/currency/source/owner violations and inconsistent page
coverage fail closed. Max 50 records/page, 100 pages and 5,000 raw records across an
entire tool call. Maximum 10 seconds includes repository authorization and provider
I/O. Underlying non-cancellable adapter promises may settle later; their results are
not disclosed, and an elapsed deadline prevents subsequent provider calls. Search
pages shrink to fit 16 KiB with explicit continuation/truncation. Oversized calculations
fail with `LIMIT_EXCEEDED`; totals/groups are never silently truncated.

No facts cache or conversation storage is exposed. Already-returned facts cannot be
recalled: B/Gerald must revalidate current consent, principal and transaction revisions
before rendering persisted selections or old results on later turns. The current
memory repository uses defensive copies and a scoped content revision fingerprint;
a SQL implementation must supply equivalent atomic revision/consent guarantees.

## Fixture manifest and independent arithmetic

Seed/version: `agus-fictional-ng-v1`. Fixed verification clock:
`2026-10-17T10:00:00.000Z` (11:00 WAT). Default runtime clocks use real server time;
tests explicitly inject the fixed clock. Nothing silently freezes production time.
Consent expires at `2027-01-01T00:00:00.000Z`; tests cover the exact expiry boundary.

All names, account IDs, last-four displays, transactions and evidence are invented.
There are two fictional owners, three accounts, two consents, 77 transaction records,
one synthetic evidence record and one supplied balance. Amina's savings balance is
not provided and its unsynced history has unknown coverage. Amina current has 76
records including 60 separate synthetic market purchases; Tunde has one private row.
The explicit boundary scenarios include an out-of-interval November midnight row;
these are synthetic test events, not forecasts or verified future bank postings.

For Amina current over Lagos October 2026 (`2026-09-30T23:00:00Z` through
`2026-10-31T23:00:00Z`, exclusive):

```text
Expenses: Ada Okafor 500000 + Ada Obi 750000 + food 125050
          + one kobo 1 + midnight 100 + 60 market purchases × 10000
        = 1975151 kobo (₦19,751.51)
Income:   synthetic salary 25000000 kobo (₦250,000.00)
Net:      25000000 - 1975151 = 23024849 kobo (₦230,248.49)
Included: 66 records
Excluded: 1 pending, 1 failed, 1 reversed original, 1 unknown,
          1 linked reversal credit; 1 undated record flagged separately
```

Dated searches contain 71 rows in this interval. September and October 2025 payments
are queried independently; there is no implicit lookback or date-language guessing.
Duplicate ingestion does not change totals. Distinct provider IDs with identical
name/amount/time remain distinct. Stored search indexes are regenerated from validated
provider fields, so supplied tokens cannot manufacture a match. Descriptions remain
untrusted strings; downstream UI/CSV rendering must escape them. No description is
executable, a permission grant or an instruction to the registry.

## Reproducible usage

```ts
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  FIXTURE_NOW,
  fixturePrincipal,
  lagosDateInterval,
} from "@/lib/financial-data";

const repository = createFixtureRepository();
const clock = () => FIXTURE_NOW; // Tests/demo only; use a trusted real clock in integration.
const source = createFixtureDataSource({ repository, clock });
const tools = createReadTools({ repository, sources: [source], clock });
const result = await tools.execute(fixturePrincipal, {
  protocolVersion: 1,
  callId: "example-1",
  name: "calculate_spending",
  args: {
    accountIds: ["amina-current"],
    ...lagosDateInterval("2026-10-01", "2026-11-01"),
    groupBy: "month",
  },
});
// result.data is typed as ToolData["calculate_spending"] | null.
// ctx must come from the server session; never accept fixturePrincipal from a client.
```

## Exact contract dependencies for Agent B

1. Review **`e9041da4c71be5316f382f9d987624cd7aff9966`** with Gerald/founder. Do not
   silently treat this as frozen/approved, or make another transaction/tool union.
2. Import `ToolCall`, `ToolArgs`, `ToolData`, `ToolName`, `ToolResult`,
   `ReadToolDispatcher`, `TransactionView`, `EvidenceView`, `PermissionContext`,
   `ToolCallSchema`, `ToolArgsSchemas`, `ToolDataSchemas` and `toolResultSchema`
   from `contracts.ts`. Typed fake dispatchers can depend solely on that commit.
3. Use only injected `ReadToolDispatcher` for financial reads. Do not give the model
   repository/source factories, consent IDs, administrative helpers or payment code.
4. Preserve envelope outcome/error/coverage/simulation/source/truncation semantics.
   Render partial totals as available records. Do not infer absence from empty searches,
   select the first ambiguous candidate, treat `single_candidate` as proof of payment,
   or promote source status/synthetic evidence into recipient-credit confirmation.
5. Recheck selections with `get_transaction` and current server authorization on each
   turn; compare `revision`, account and candidate IDs. Bind stored context to tenant,
   actor, account, consent version and expiry using Gerald's server-side resolver.
   This module does not implement context persistence or recall already-disclosed data.
6. B owns duplicate call IDs/identical calls per turn, 5-tool/6-model/60-second loop
   budgets, 48 KiB turn budget, grounded facts and genuine inference checks. A enforces
   each individual read's 10-second/16 KiB limits. No genuine model call was tested here.

## Exact next steps for Gerald

1. Review this draft against Phase 1, decide the proposed deviations below with the
   founder, and record the approved contract SHA. Do not merge automatically.
2. Complete G0's existing `.history` lint cleanup and bank-retry browser repair in
   Gerald-owned files; neither is repaired or excluded here.
3. Integrate reviewed A commits into `integration/agus-financial-memory`; preserve
   the contract commit ancestry. Approve any Antigravity dataset with both the strict
   schema and relational ingestion validation. Use the fixture manifest above.
4. Supply a trusted session-to-principal mapping, scoped consent/grant resolver and
   real server clock. Never trust client/model actor, owner, consent, source or mode.
   Demo principals are fictional fixtures, not proof of multi-user login isolation.
5. Implement SQL persistence/migrations under your ownership with composite scoped
   keys, atomic read/version semantics, retention/deletion and revocation. Do not
   reuse the singleton payment aggregate. Wire the approved compatibility seam and
   authenticated read route, then inject only the dispatcher into B.
6. Repeat unit, typecheck, lint, build, HTTP/browser and integration isolation tests
   on the integrated candidate. Isolated A checks do not certify route/auth/persistence
   integration. Arrange independent review and explicit founder release decisions.

## Proposals and limitations requiring review

- V1 errors add `INVALID_PROVIDER_DATA`, `CURRENCY_MISMATCH` and
  `ARITHMETIC_OVERFLOW` to distinguish integrity failures without unsafe payloads.
- UTC timestamps support at most three fractional digits (millisecond resolution);
  finer precision is rejected explicitly, rather than silently truncated.
- Opaque IDs use a bounded ASCII grammar (`A-Z a-z 0-9 _ . : -`); unsafe external IDs
  need adapter-side mapping. Bank masking is last four digits only, not full numbers.
- Search adds explicit match count and candidate ambiguity; default search limit is
  10 (maximum 25). Snapshots are bounded in-memory capabilities (100 search cursor
  entries, 200 provider entries); restart/eviction returns `CURSOR_INVALID`.
- Balance freshness is a conservative 24-hour fixture policy, not a bank SLA. Missing
  or stale values are withheld. An unsynced account's history is `unknown` coverage.
- V1 reversal ingestion requires a same-owner/account original reversed debit of the
  same magnitude; partial reversals and unmatched/mirrored histories are rejected for
  later explicit adapter design. No fuzzy deduplication or account-identity merging.
- Repository construction is in-memory and bounded; no SQL durability, distributed
  revocation, delegated roles, live/sandbox adapters, real-account linking, artifact
  resolver, AI inference, hosted deployment or live transactions are implemented or
  verified. Source/mode types reserve names without claiming adapter capability.
- These are review decisions, not blockers to this authorized isolated fixture module.
  Founder/Gerald approval is required before common-contract adoption or integration.

## Verification evidence

Commands and final outcomes are recorded below after execution. Local logs under
`/tmp/agus-a-*` are ephemeral evidence, not deployment artifacts. Existing tests and
assertions are unchanged. Browser outputs are redirected to temporary directories.

Final environment: Node 24.19.0, npm 11.9.0, Next.js 16.4.1; 17 October 2026.

| Command                                                                                                                                                                                       | Actual result                      | Evidence / limits                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --cache /tmp/agus-agent-a-npm-cache`                                                                                                                                                  | PASS, exit 0; 247 packages         | Clean lockfile install through the supported network permission; no dependency changes.                                                                                                                                                                                                                                                            |
| `npm test -- tests/financial-data`                                                                                                                                                            | PASS, exit 0; 118 tests / 5 files  | Final focused run 2.40s; `/tmp/agus-a-focused.log`.                                                                                                                                                                                                                                                                                                |
| `npm test`                                                                                                                                                                                    | PASS, exit 0; 333 tests / 16 files | 118 new tests + unchanged 215 existing tests. `/tmp/agus-a-full-test-final.log`. Provider/model calls in existing tests are fixtures/mocks.                                                                                                                                                                                                        |
| `npm run typecheck`                                                                                                                                                                           | PASS, exit 0                       | `/tmp/agus-a-typecheck.log`; strict TypeScript includes new source/tests.                                                                                                                                                                                                                                                                          |
| `node_modules/.bin/eslint src/lib/financial-data tests/financial-data`                                                                                                                        | PASS, exit 0                       | `/tmp/agus-a-eslint.log`; no module errors or warnings.                                                                                                                                                                                                                                                                                            |
| `node_modules/.bin/prettier --check src/lib/financial-data tests/financial-data docs/integration/phase2/agent-a.md`                                                                           | PASS, exit 0                       | `/tmp/agus-a-prettier.log`; scoped formatting only.                                                                                                                                                                                                                                                                                                |
| `npm run lint`                                                                                                                                                                                | FAIL, exit 1                       | Exactly the three pre-existing `.history` merge-marker parse errors at line 235: `dashboard_20261016121434.tsx`, `dashboard_20261016121849.tsx`, `dashboard_20261016121900.tsx`. `/tmp/agus-a-full-lint.log`. These are Gerald's G0 baseline issue; nothing excluded or changed.                                                                   |
| `NEXT_TELEMETRY_DISABLED=1 npm run build`                                                                                                                                                     | PASS, exit 0                       | `/tmp/agus-a-build-final.log`; production webpack build, TypeScript and route generation. Generated `next-env.d.ts` restored to the exact base contents afterward. No new route.                                                                                                                                                                   |
| `npm run test:http`                                                                                                                                                                           | PASS, exit 0                       | `/tmp/agus-a-http.log`; existing authenticated production fixture workflow, simulated submission/reconciliation, duplicate rejection and CSV. No real provider calls.                                                                                                                                                                              |
| `CHAT_SCREENSHOT_DIR=/tmp/agus-a-chat UX_SCREENSHOT_DIR=/tmp/agus-a-ux CONVERSATION_SCREENSHOT_DIR=/tmp/agus-a-conversation DEMO_POLISH_SCREENSHOT_DIR=/tmp/agus-a-demo npm run test:browser` | FAIL, exit 1                       | First four suites pass (safety, chat-first, chat UX, mocked-model conversation; responsive suites at 1440/820/390/320px). Fifth reproduces Phase 1's 30-second timeout waiting for “Retry bank loading” at `scripts/browser-demo-polish.mjs:145`, before later fifth-suite cases. `/tmp/agus-a-browser.log`. No test weakened or UI fix attempted. |
| `git diff --check` and owned-path review against the exact base                                                                                                                               | PASS, exit 0                       | Only Agent A's three permitted path groups changed; original payment tests/source and application files unchanged.                                                                                                                                                                                                                                 |

HTTP/browser checks cover the existing application; they do **not** claim that the
new isolated module is wired into routes/UI. Their run preceded only the final isolated
timestamp-validator amendment; the complete unit suite, typecheck and build were
rerun after that amendment. This module does not call the app or a provider network.

Earlier development failures were investigated and repaired, not counted as passes:
initial shell `git fetch origin` could not reach the sandbox proxy; retry using normal
network permission passed. A direct `tsx -e` probe failed on sandbox IPC (`EPERM`);
`node --import tsx` avoided that CLI IPC. Initial module loading found Zod forbids
`.pick`/`.extend` on refined objects; explicit view schemas and `.safeExtend` fixed
that before the first published contract. Early implementation typechecks found
control-flow narrowing and a formatter-shifted `@ts-expect-error` directive; named
`never` helpers and a compile-time conditional type assertion fixed them. One focused
run had five harness failures from spying on frozen adapter methods; tests now wrap a
copy, retaining the actual permission assertions. A newly added precision assertion
also caught the first incomplete fractional-second guard; the corrected final validator
and all 118 focused checks pass. Final logs above supersede those development runs.

There are no unresolved Agent A test/typecheck/build failures or environmental
blockers. Repository-wide lint and browser failures are explicitly retained baseline
issues. G0 repair, contract acceptance, SQL/API integration and independent integrated
release review remain outstanding; they are outside this authorized workstream.
No genuine inference, bank connectivity, managed PostgreSQL, hosted deployment,
production credentials or real-money transaction was requested or verified.
