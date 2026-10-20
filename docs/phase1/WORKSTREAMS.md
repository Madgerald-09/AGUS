# AGUS Phase 1 — work packages and integration order

Date: 17 October 2026. These are **launch-ready assignments, not permission to start**.
Francis reviews Phase 1 first. Gerald owns engineering coordination after authorization.
All work starts from the accepted Phase 1 commit on top of
`a73d96c92d57df812485b66213689658e6c80391`, or a recorded newer integration SHA.

## Coordination and branch rules

1. Gerald creates `integration/agus-financial-memory` from the approved baseline.
   Each worker uses its own branch and worktree; never share a checkout, database
   directory or `.env.local`. Record base SHA, owned paths, dependency commit and
   actual checks in each draft PR. No direct pushes to `main` or automatic merging.
2. Ownership below is exclusive. Shared seams (`package*.json`, migrations,
   configuration, public API route, existing intelligence and dashboard) belong to
   Gerald until the explicit UI ownership transfer. A worker needing another path
   proposes a change in its PR and waits for the owner to integrate it. No worker
   overwrites shared files, resolves another person's changes silently or runs a
   whole-repository formatter.
3. Agent A first publishes the contract-only commit in its work package. Gerald and
   B review it against `ARCHITECTURE_CONTRACTS.md`. Gerald incorporates it into the
   integration branch, then records that exact SHA as the common base. Freeze v1
   exports. Contract amendments require an explicit versioned change coordinated by
   Gerald; B cannot create an alternate transaction type to avoid a dependency.
4. A and B can then work simultaneously in disjoint directories using the frozen
   contract. B uses typed fake tool results in its own tests until A is ready.
   Antigravity receives the frozen dataset schema before starting. Gerald integrates
   A, the reviewed dataset, then B, resolves seams, and runs the complete checks.
5. UI work starts only after Gerald records the integrated core as stable. Gerald
   hands dashboard/CSS ownership to the UI agent for a bounded window and pauses
   edits there. Reviewer assesses the exact candidate SHA; later changes invalidate
   the relevant review and must be checked again. Francis approves release scope.

No assignment may modify payment authorization, live flags or payment engine behavior.
Existing `payments.ts`, `paystack.ts`, `auth.ts`, `config.ts`, payment digests/types,
and payment routes are protected. Report a needed change as a blocker/proposal.
No Wema/Mono implementation, real account connection, PWA or real payment belongs
to the October 22 target by default. No person is contacted by these documents.

## G0 — Gerald: restore a clean baseline and freeze the contract

Branch: `fix/agus-baseline-readiness`, then coordination branch above.

Owned files: tracked `.history/**` cleanup, `.gitignore`, narrowly scoped lint/TS
configuration if needed, `src/components/dashboard.tsx` bank-loading recovery only,
integration checklist under `docs/integration/phase2/`.
This is a separate proposed follow-up; Phase 1 does not apply the cleanup.

First reproduce the lint and browser failures reported in `READINESS_REPORT.md`. Remove accidental
editor snapshots from tracking and ignore future `.history/` output after reviewing
their contents. Prefer removing irrelevant tracked artifacts over hiding real source
errors. Do not weaken tests or exclude application code. The production build passes;
the early missing-module build attempt was an installation problem. Investigate the
duplicate bank-loading effects and restore explicit bank-failure/retry behavior;
the existing demo-polish assertion must remain. Preserve Gerald's merged dictation
and stale-editor protections. This bounded regression repair precedes the later UI
polish window; no UI agent may edit the dashboard concurrently.

Output: small reviewable baseline-fix PR, exact checks, plus a contract-freeze record.
Acceptance: `npm ci`, full test suite, typecheck, lint, build, HTTP and all five browser
suites have actual recorded outcomes. Baseline defects must remain visible if any fail.
Dependencies: founder authorization for follow-up work; Phase 1 report.

## A — Codex Agent A: scoped transaction data and deterministic tools

Branch: `feat/agus-financial-data`.

Exclusive owned files:

- `src/lib/financial-data/**`: contracts/strict validators, source and repository
  interfaces, fictional provider, normalization, search, calculations, evidence views,
  read-tool handlers and a dispatcher accepting an injected permission context.
- `tests/financial-data/**`: contract, arithmetic, search, paging, evidence and
  service-level ownership/consent tests. Keep filenames ending `.test.ts`.
- `docs/integration/phase2/agent-a.md`: schema version, fixture seed/clock,
  exported API, exact tests and limitations.

Dependencies: G0 baseline recorded; contract-only commit reviewed/frozen before B
develops against it. Antigravity's dataset is optional input, never a critical-path
dependency: A supplies a minimal valid fictional fixture itself.

Expected exports: `contracts.ts` types/Zod schemas, `createFixtureDataSource`, scoped
repository interface, read-tool registry/dispatcher with **no payment mutations**.
Inject clock, grants and repository so tests are deterministic. No SQL migration,
legacy `domain.ts` edits, model calls, UI or routes. Keep new records out of the
payment aggregate. Treat the existing `banking-data.ts` as Gerald's compatibility seam.

Acceptance: DATA-01/02/03, PERM-01/02 and FACT-01 from the architecture contract;
hand-calculated fixture totals, two-principal denial on every operation, consent
revocation during I/O, missing evidence/balances, status/reversal handling, safe-integer
overflow and pagination beyond one page. Full current payment tests remain unchanged.
Output: documented exports, tests, fixture manifest and draft PR with exact base SHA.

## B — Codex Agent B: read-only planning and grounded follow-ups

Branch: `feat/agus-readonly-orchestration`.

Exclusive owned files:

- `src/lib/financial-agent/**`: strict planner decisions, model adapter wrapper,
  constrained executor, facts renderer, contextual-selection logic and context-store
  interface. Import A's frozen contract; inject tools and storage.
- `tests/financial-agent/**`: budget, adversarial-grounding, selection, failure and
  scoped-context tests, using typed tool fakes.
- `scripts/verify-financial-model.mjs` (or `.ts`, select one): explicit manual genuine
  inference check with synthetic inputs, fixture-only payments, no transport mock.
- `docs/integration/phase2/agent-b.md` and `model-verification.md`: instructions and
  sanitized real-call evidence or explicit blocked status.

Dependencies: A's frozen contract SHA, Gerald's chosen existing model configuration,
and approved context persistence interface. B can test orchestration before A's
implementation is ready; integration waits for A. Genuine inference additionally
requires legitimate privately configured model access and supported egress. Do not
request production/payment credentials or silently switch the configured model.

Acceptance: AI-01/02/03 and MODEL-01; loops stop at deadline/call/byte budget;
unknown tools/extra keys/actor spoofing fail closed; ambiguous/zero/missing evidence
cases remain honest; follow-up selection survives injected store reload and rejects
stale revisions. Every financial statement renders cited current facts. Existing
model response/clarification prose remains quarantined. A failed genuine call is
reported as unverified, while mocks remain useful regression evidence.

No changes to existing `intelligence.ts`, `ai-inference.ts`, `ai-response.ts`,
`conversation-policy.ts`, draft-edit files or API route: propose Gerald's seam changes
in the handoff. No approval, submit, retry or OTP tools. No payment-engine changes.
Output: isolated module, tests, integration notes and draft PR.

## G1 — Gerald: technical integration, persistence and deployment readiness

Branch: `integration/agus-financial-memory`; use small separate PRs for baseline
cleanup and persistence/integration so each can be reviewed independently.

Exclusive owned seams:

- `src/lib/banking-data.ts` compatibility export; new
  `src/lib/financial-integration/**` permission resolver, scoped persistence and
  sanitized payout-evidence projection if needed.
- New authenticated read route `src/app/api/financial-agent/route.ts` and new
  `src/lib/financial-integration/context-store.ts`; inspect Next.js route conventions
  before coding. Existing catch-all route is protected for payments; if a minimal
  read-only seam there is unavoidable, propose and review it explicitly.
- `src/lib/intelligence.ts`, existing AI/conversation files only for the minimal
  approved handoff to read queries; keep the existing draft/correction paths.
- New `migrations/0002_financial_memory.sql` (check current numbering first),
  migration runner/initialization wiring, `package.json`, lockfile, configs,
  `.env.example`, deployment documents and integration tests/scripts.
- New `tests/financial-integration/**`, `scripts/verify-financial-integration.*`
  (one extension only), `docs/integration/phase2/gerald.md` and release checklist.

Responsibilities: maintain ownership map and frozen API version, integrate commits,
choose scoped fixture persistence, verify composite foreign keys/indexes, expose only
sanitized views, isolate new context from global legacy state, record build/test
artifacts, inspect secrets handling and coordinate independent review. Test both
PGlite single-process persistence and managed PostgreSQL only if a legitimate test
database is available; do not claim the latter from PGlite tests.

Provider-adapter support here means contract review, dependency/egress checklist,
official documentation and future test matrices. Wema/Mono code or account linking
requires a separate authorized work package and legitimate access. Paystack test
listing/resolution may be checked later with an authorized test account; no transfer
is necessary to prove bank-data architecture. Never assume credentials exist.

Acceptance: all contract integration gates and untouched payment regressions, HTTP
authentication/origin checks, persistence/reload, two-principal service isolation,
dataset/model provenance in UI payloads, no secret or raw financial logging, and
deployment rehearsal using fixtures. Managed hosting must have HTTPS/exact origin,
durable storage or managed PostgreSQL, scheduler/backup plan and visible simulation
labels. Readiness is distinct from authorization to deploy or activate live features.
Output: reviewed integration PR(s), reproducible commands and evidence, release SHA
and unresolved external blockers.

## S — Antigravity: synthetic data and repetitive QA only

Branch: `chore/agus-synthetic-fixtures`.

Exclusive owned files: `fixtures/financial-memory/**` JSON/manifest/expected totals,
`docs/qa/financial-memory/**` scenario sheets and bounded documentation updates there.
No edits to A's source fixture generator; hand files to A for validation. No shared
README/Phase 1 edits without Gerald's explicit assignment.

Dependencies: A's published JSON schema and fixed clock/seed. Include two fictional
owners, repeated names, multiple matches, date/amount boundaries, paginated history,
pending/failed/reversed/unknown cases, missing data/evidence and prompt-injection text
as labelled hostile fixtures. No real customer data, invented provider receipts or
real-looking proof of bank credit. All records carry fictional provenance.

Acceptance: every file validates with A's schema; manifest records counts, fixed
dates, fictional ownership, expected totals and scenario IDs; A independently checks
arithmetic. QA entries record command/commit/actual outcome, not copied prior claims.
No financial code, permissions, tests weakening, secrets or deployment changes.
Output: small dataset PR and reproducible QA report.

## UI — Codex UI Agent: final polish after core stability

Branch: `polish/agus-financial-memory-ui` from Gerald's stable candidate SHA.

Owned files during explicit transfer window: `src/components/dashboard.tsx`,
`src/app/globals.css`, new `src/components/financial-memory/**`, and
`docs/qa/financial-memory-ui/**`. Gerald must land the minimal functional integration
before this window; UI owns polish only. UI-specific regression tests may use
`tests/financial-memory-ui/**`; shared browser scripts stay Gerald-owned.

Acceptance: readable results/citations, multiple-match selection, missing evidence,
provider unavailable and consent states; clear fictional/sandbox status and freshness;
keyboard/focus and no overflow at 1440/820/390/320px; native-device keyboard/dictation
limits recorded honestly. Existing reviewed details, password clearing, explicit
submission and status distinctions remain intact. No API, auth, calculation, payment
engine or PWA work. Output: narrow UI PR, screenshots and actual browser results.

## R — Independent Reviewer: release assessment

Branch only if review artifacts are requested: `review/agus-financial-memory`.
Owned output: `docs/reviews/financial-memory/**`; default role is read-only review.
Reviewer must be independent of implementation ownership and inspect the exact
integrated candidate SHA, not isolated worker claims.

Check PERM/FACT/AI/PAY/RELEASE gates, malicious model/provider text, cross-user
evidence and context, consent expiry/revocation, incomplete pagination totals,
simulation disclosures, stale reviews/editors, idempotency and restart/reconciliation
regressions. Independently run the mandatory commands; distinguish mocks, genuine
inference, genuine test-provider access and unverified live claims. Report severity,
reproduction, evidence and release recommendation. No silent fixes, weakened tests,
merges, live activation or external communications. Output: findings plus a written
go/no-go recommendation; Francis retains release authorization.

## Milestones — WAT (UTC+1)

Hard screening deadline: **22 October 2026, 17:00 WAT (16:00 UTC)**. These are targets,
not claims of completed work. Gerald records owner, SHA and gate outcome daily.

| Date   | Target and exit gate                                                                                                                                             | Fallback if gate misses                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Oct 18 | Francis reviews Phase 1; G0 baseline cleanup; A publishes/finalizes contract; B reviews; scoped fixture schema and integration base frozen.                      | Keep current supervised fixture demo; do not start incompatible parallel code.                     |
| Oct 19 | A's deterministic tools and synthetic scenarios pass; B's mock-backed executor/grounding/context pass independently.                                             | Reduce read-query scope; keep missing capabilities explicitly unavailable.                         |
| Oct 20 | Gerald integrates A + dataset + B; scoped persistence/API checks; genuine model verification if authorized access exists.                                        | If model gate fails, label parser mode; never advertise connected AI or substitute mocked success. |
| Oct 21 | Stable core SHA; UI polish window; complete HTTP/browser/regression run; independent security/grounding review; fixture deployment rehearsal and demo rehearsal. | Freeze the last verified fixture experience; defer polish and provider experiments.                |
| Oct 22 | 10:00 candidate freeze; by 12:00 reviewer disposition and evidence; 14:00 final rehearsal; target submission by 16:00, buffer until 17:00 deadline.              | No late financial changes. Present only verified capabilities and explicit simulations.            |

If identity/provider/model/persistence gates fail, narrow the demonstration rather
than imply missing capabilities work. Integration into `main` or deployment still
requires the founder's review decision and normal repository review process.

## Conditional finale roadmap — November 6, Lagos

Only if selected and Francis authorizes further scope:

- Oct 23–25: review screening feedback; settle Personal/Business identity, roles,
  consent/retention policy and account model. Validate legitimate provider access
  and supported egress before scheduling an adapter; no credentials in chat/Git.
- Oct 26–30: one separately scoped read-only Wema **or** Mono sandbox adapter if
  access/contracts exist; contract fixtures plus actual account-level read evidence,
  revocation, pagination, duplicate and missing-data tests. Otherwise retain fixtures
  and improve reliability. Do not promise both providers.
- Oct 31–Nov 3: managed PostgreSQL multi-process tests, backup/restore rehearsal,
  observability, model grounding evaluation and independent security/permission review.
- Nov 4–5: release freeze, native-device/network-failure rehearsals and an honest
  offline fallback; final claims/evidence review. PWA only under a separate approved
  nonfinancial package after reliability, never a dependency of safe money handling.
- Nov 6: supervised finale demonstration of the verified candidate. Real account
  connection or live payments require separate authorization and all relevant
  readiness gates; selection for the finale grants neither.
