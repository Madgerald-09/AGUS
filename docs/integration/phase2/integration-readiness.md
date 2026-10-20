# AGUS Phase 2 integration readiness

Verification date: 18 October 2026, WAT. Deadline: 22 October 2026, 17:00 WAT
(16:00 UTC). This report covers the integration foundation, not a release decision.

## Candidate and incorporated history

- Branch/worktree: `integration/agus-financial-memory`, `/workspace/agus-financial-memory`.
- Reviewed PR base: Phase 1 PR #13, `45f553177f86c2a40de6885304ed9bd47a5af5de`,
  branch `docs/agus-phase1-foundation-20261017`, above main `a73d96c92d57df812485b66213689658e6c80391`.
- Combined base after preserving #14/#15 history:
  **`907617d4221d9680b0b8316fcde13e6fce15a70a`**.
  Merge #14: `c878f818cff024867426f83f093f5b650cfe5065`; merge #15: `907617d`.
  Both were conflict-free. Original branches were not modified.
- Runtime candidate: **`765a41bdf18e15280b903bffdfb76f8b9dc4117f`**.
  Integration implementation: `6a5249ab9b537e44caab7d3ac19f955feef6db3e`;
  schema-injected Agent B storage seam: `e1e07af6103608acaedc4c3a1fd07ffdd5f5e122`;
  expiry/stale-writer protection: `765a41b`.
  The final handoff commit adds documentation only; its exact SHA is recorded in
  the draft PR and delivery message rather than self-referencing this file.

Incorporated #14 commits, in order:

```text
e37a13708006ab2a3001a93e87c9dc744385f933 provisional v1 contracts
e9041da4c71be5316f382f9d987624cd7aff9966 millisecond UTC precision
5947e7efd2eb01af346941407bf9de30c043379d fictional memory/read tools
08fd872cdf666964ca6625b2b09bc4c7180c682a amended reversal/balance contract
9136c754d7f8f6ea9f7c97ea0a7c7008c4cb2514 P2 repairs and cursor reclamation
a60206657c9a57f58479cc2e08679a907813fe5f Agent A repair handoff
```

Incorporated #15: `58f82cbcbf3640e272cc293d10e3bff29fafef1d` and
`70487725dfb303b2bdbd2e3957470a38ba2ae53e`.
The six editor-history removals, ignore rule and six-line dashboard bank-loading
repair are exactly the reviewed baseline change. No further dashboard edits.

The user's assignment authorizes these integration-owned seams and accepts
**`08fd872cdf666964ca6625b2b09bc4c7180c682a` as a provisional October 22
fixture-demo integration baseline**. It does not approve a production banking
specification, multi-user identity system or deployment. Contract contents remain
byte-for-byte equal to that dependency, also in inspected PR #17.

## Ownership and implementation

New implementation is confined to `src/lib/financial-integration/**`, the new
`src/app/api/financial-agent/route.ts`, `migrations/0002_financial_memory.sql`,
`scripts/verify-financial-integration.mjs`, the opt-in initialization in
`scripts/migrate.ts`, `.env.example`, integration tests and this handoff.
No dependency changes. No payment authorization, OTP, verification, submission,
policy, provider adapter, existing catch-all route, legacy AI or Agent B source edits.
The original checkout remains clean on `work`; databases and evidence are isolated.
Remote refs were inspected before edits, after the #16/#17 notice and before push
preparation. #13/#14/#15, Gerald and main still match the recorded heads; the
integration branch was absent remotely. Publishing uses a normal new-branch push,
with no force push or updates to source branches.

Exact integration-owned file manifest (relative to the combined base; inherited
#14/#15 files are identified by their unchanged original commits above):

```text
.env.example
docs/integration/phase2/integration-readiness.md
migrations/0002_financial_memory.sql
scripts/migrate.ts
scripts/verify-financial-integration.mjs
src/app/api/financial-agent/route.ts
src/lib/financial-integration/access.ts
src/lib/financial-integration/context-persistence.ts
src/lib/financial-integration/context-store.ts
src/lib/financial-integration/service.ts
src/lib/financial-integration/storage.ts
tests/financial-integration/integration.test.ts
tests/financial-integration/persistence-codec.ts
tests/financial-integration/restart-worker.ts
tests/financial-integration/restart.test.ts
```

The existing operator session is verified by unchanged `operator(req)`. Only then
does the server resolve `fm_principals.operator_id` to tenant/owner. The configured
operator initially maps to `fictional-tenant` / `fictional-amina`; the persisted
binding is never overwritten on restart. Neither request JSON, query parameters,
model calls nor headers can supply identity or permissions. Request ID and clock
are server-generated. This is one configured demo operator, not multi-user login.
Tests also provision a second binding administratively to exercise route isolation.

The integration requires `FINANCIAL_DEMO_ENABLED=true` and `PAYMENT_MODE=fixture`.
It defaults off and returns 503 outside that combination. It does not change any
payment/live flags. The legacy workflow remains separate and is not a source of
linked-bank history, financial context or account authorization.

`GET /api/financial-agent` returns authorized account IDs, labels, last-four masks,
currency and fixture provenance. It checks `accounts:read` and rechecks bindings.
`POST /api/financial-agent` accepts exactly A's strict `ToolCallSchema` for the five
reads. POST requires the exact configured Origin, JSON content type and a streamed
body of at most 8 KiB. Unknown fields/tools and identity spoofing fail. GET rejects
foreign Origin/cross-site browser requests and query parameters; same-origin browser
GET needs no manually supplied Origin. Both methods authenticate and return
`Cache-Control: no-store, private`. No cross-origin permission is granted.

Successful and error responses include a fictional simulation label. Only A's
sanitized views leave the service: no owner/tenant/consent IDs, provider account
references, raw records, artifact URLs, tokens, keys or internal exception details.
Provider descriptions remain untrusted strings; render as text, never raw HTML.
No administrative/ingestion/revocation endpoint, arbitrary execution endpoint or
model endpoint is exposed. No financial payload logging was added.

## Durable state and authentication limits

`fm_consents`, `fm_accounts`, `fm_transactions`, `fm_evidence`, `fm_summaries`,
`fm_principals`, `fm_context` and `fm_seed` are separate from `workflow_state`.
Composite keys/foreign keys include tenant, owner and account; evidence links also
include transaction ID. JSON identity CHECK constraints match indexed SQL keys;
transactions have scoped provider-ID uniqueness, date and normalized-search indexes.
The SQL migration matches runtime initialization, checked by a test. A one-time
transactional seed claim prevents restarts from reseeding data or restoring revoked
consent. Search fields are normalized before persistence.

Each repository operation reads a scoped, single-statement database snapshot and
validates it through A's full relational repository validator. Consent/version and
data-revision reads are fresh; the dispatcher/source recheck authorization after
I/O and before disclosure. The implementation deliberately favors validation over
large-history performance and is limited to the bounded fictional dataset.

PGlite disk persistence, process restart, sessions, bindings, all 77 records,
context, CAS and persistent revocation are tested. Use exactly one Node process
per PGlite directory. The existing PostgreSQL connector is compatible at the SQL
interface but **managed PostgreSQL, multiple workers, backup/restore and operational
durability were not tested**. Disk/volume loss is not solved by process-restart tests.

There are two private context interfaces:

- `createContextStore(ctx, repository, clock)` returns a bound `load(id)` / `save(id,
expectedRevision, state)` store for validated account/selection state. It records
  source fingerprints (including consent versions), selected and candidate IDs,
  revisions, filters, result IDs and untrusted messages. Every disclosure checks
  current scopes and revisions; stale selections fail. It conservatively requires
  all three read scopes. This interface is not the general-conversation store.
- `createContextPersistence(principal, parse, clock)` supplies B's structural
  `load(key)` / `compareAndSwap(key, expectedRevision|null, next)` interface.
  The server injects B's own `ContextSchema.parse` after review; no duplicate B
  schema or orchestration is imported here. It preserves the complete validated
  context, binds composite keys to the authenticated principal, checks stored and
  payload revisions, and atomically rejects competing writes. Its 32 KiB record
  ceiling accommodates B's separately bounded transcript and candidate metadata.
  It needs no bank grant for general conversation. B's access resolver and
  current-turn tool checks must revalidate financial selections before use;
  persisted prose is never financial evidence.

Both stores expire reads after 15 minutes of inactivity and use distinct physical
key namespaces. An expired ID remains unavailable for writes: start a fresh server-
validated conversation ID. Reusing revision 1 could let an old writer overwrite a
new conversation. Expiry is an access limit, **not physical deletion**; expired
records remain on disk. Retention, garbage collection, user deletion, encryption
and real-data model disclosure policy remain later review gates. Never migrate
legacy ownerless messages or credentials into these stores.

## Explicit demo-only policies

- **Reversals:** accept a returned-funds link only to a same-owner/account reversed
  debit of equal magnitude. Partial/unmatched/mirrored reversals are unsupported.
  Exclude reversed originals and linked credits from ordinary expenses/income;
  preserve `reversalOfId` in search/detail and excluded counts in calculations.
- **Balance freshness:** require a valid observation timestamp for any numeric
  balance, including partial, zero and negative balances. Withhold balances older
  than 24 hours as `stale`; missing stays null. This is a fixture policy, not a bank
  SLA. Runtime uses actual time; only tests inject `FIXTURE_NOW`.
- **Cursors:** process-local, single-use, opaque continuations with the original
  15-minute expiry; principal/filter/consent/data revision binding; 100 active search
  and 200 provider continuations. Consume after validation and before I/O. Replay,
  concurrent reuse and restart invalidate tokens. Restart requires a fresh search.
  These policies do not certify distributed paging or real bank cursor semantics.

## PR #16 and #17 disposition

Inspected remotely while working; neither is incorporated or modified:

| PR                                                                   | Exact inspected head                       | Disposition                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [#16](https://github.com/omnmlr/hackaholics-financial-agent/pull/16) | `5d25d244bb783569e06dbbe407cfed0481a33e91` | Two QA Markdown documents, additional fictional Adeyemi/Fatima scenarios; no executable dataset imported.                                   |
| [#17](https://github.com/omnmlr/hackaholics-financial-agent/pull/17) | `043fa193bc362ae8504d9cd8a2c3b76520b590ee` | Draft Agent B orchestration, stacked on #14 at `a602066`; inspected interfaces and handoffs, not an independent review or integration pass. |

#16's October 16 expenses are **6,250,000 kobo**, for its own accounts and interval.
This foundation seeds only A's `agus-fictional-ng-v1` Amina/Tunde dataset; Amina's
October expenses are **1,975,151 kobo**, income **25,000,000**, net **23,024,849**.
Do not mix totals, account IDs or expectations. #16 repeats A's seed label while
describing different data, and its actor IDs differ from owner IDs, whereas A's
current access rule requires equality. Give the additional dataset a distinct
manifest identity and resolve those bindings before schema-valid executable QA.
Neither its normative rubric nor #17's reported 85 tests are counted as tests run
on this candidate.

After independent review, merge only #17's commits above `a602066`, preserving
ancestry; #14 is already incorporated and must not be duplicated. Expected B-only
commits: `d79b077568906cbe86f9480ebd07687fca9d4af1`,
`38316bd1bf8e2523545968b7324fad5e9124caf7`, `043fa193bc362ae8504d9cd8a2c3b76520b590ee`.
Recheck heads and changed paths first. Do not silently import an unreviewed draft.

## Exact Agent B composition seam

This is future integration guidance, not code already wired or tested with B:

```ts
// Only after review/incorporation of #17, in integration-owned server code:
const capability = await authorizedFinancialAccess(request);
const clock = () => new Date().toISOString();
const store = createContextPersistence(
  capability.context,
  ContextSchema.parse,
  clock,
);
const agent = createFinancialAgent({
  model: createConfiguredModel(),
  tools: capability.tools,
  access: createRepositoryAccess(createDurableRepository(), clock),
  store,
  clock,
});
const reply = await agent.turn({
  ctx: capability.context,
  conversationId: validatedConversationId,
  text: validatedUserText,
  accountIds: serverSelectedAuthorizedAccountIds,
});
```

Import `authorizedFinancialAccess` from `financial-integration/access`,
`createContextPersistence` from `financial-integration/context-persistence`,
`createDurableRepository` from `financial-integration/storage`; B exports the
remaining names from `financial-agent`. Initialization occurs through the
authenticated capability before either store is used. Standalone server scripts
must call `initializeFinancialStorage()` first.

The capability implements A's `ReadToolDispatcher` but ignores a caller's context
argument and always uses the authenticated request context. Keep the global
dispatcher, repositories, sources and administrative methods outside model inputs.
Keep the dispatcher process-lived for cursors; create request-bound capabilities
and B instances per turn, with SQL context across turns. B's resolver uses fresh
repository state. Browser account selections are only requested IDs: resolve and
authorize them server-side before passing `accountIds`; use `[]` for education.

The lossless store has B's method signatures and preserves B's selection fields,
including amount/label/accessVersion/expiry. It is tested with an independent
injected schema and process restart, not B's unmerged runtime. B retains its own
ContextSchema, scrubbing, 16-message/12 KiB history bound, selection expiry,
permissions and fact revalidation. Do not substitute the foundation selection
store or B's process-local MemoryContextStore for this durable adapter.

Payment handoff from B is only intent. A later reviewed seam must send the original
request through the existing validated editable-draft workflow; never call payment
execution from this registry or treat B's text as authorization. That wiring is
outside this assignment. Current dashboard chat still uses the existing workflow.

## Genuine inference blocker and private configuration

**MODEL-01 remains BLOCKED: `MODEL_NOT_CONFIGURED`.** The environment reports no
model secret bindings/runtime variables. #17's own genuine preflight exited 2 with
provider `none`, model null, no cases and no HTTP attempt. This foundation did not
rerun or replace that evidence and did not attempt model inference.

The authorized environment owner must configure privately, without putting values
in chat, Git, command output or logs:

| Setting                        | Exact requirement                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_PROVIDER`                  | The intended existing provider, exactly `openai` or `gemini`; `none` cannot infer. Do not switch provider to bypass failure.                                                                                                                                                                                                   |
| `AI_MODEL`                     | Explicit authorized model ID accepted by that provider; grammar `[A-Za-z0-9._-]{1,100}`. B's fallback names are `gpt-4.1-mini` / `gemini-2.5-flash`, not evidence of account access or a recommendation to switch.                                                                                                             |
| `AI_API_KEY`                   | Legitimate private key for the chosen provider/project, with model/API access and available quota/billing. No Paystack or production-bank credential is needed.                                                                                                                                                                |
| Supported HTTPS egress         | Permit only the chosen official API host: `api.openai.com` (POST `/v1/chat/completions`, JSON object responses), or `generativelanguage.googleapis.com` (POST `/v1beta/models/{model}:generateContent`, JSON schema responses). Current selected allowlist lacks both. Request the supported environment configuration change. |
| Node/proxy trust               | Node 24.5+ with `NODE_USE_ENV_PROXY=1`, inherited `HTTP_PROXY`/`HTTPS_PROXY` and CA trust. Keep TLS verification. No proxy bypass or custom unreviewed API endpoint.                                                                                                                                                           |
| Demo safety                    | Keep `PAYMENT_MODE=fixture`, `PAYSTACK_SECRET_KEY` empty, live flags unchanged/false and synthetic-only inputs. Use a private durable PGlite path with one server; the model verifier uses its own in-memory fictional repository.                                                                                             |
| Local app, when later wiring B | Exact `APP_ORIGIN`, private generated `OPERATOR_PASSWORD_HASH`, server `OPERATOR_ID`, `FINANCIAL_DEMO_ENABLED=true`. Store secrets in the approved runtime binding or untracked private environment file. Restart the process after configuration.                                                                             |

After #17 is reviewed and incorporated, run from its clean candidate:

```sh
NODE_USE_ENV_PROXY=1 PAYMENT_MODE=fixture node --env-file-if-exists=.env.local --import tsx scripts/verify-financial-model.ts
```

Require actual exit 0 for its ten synthetic scenarios and sanitized SHA/provider/
model/time/schema/latency evidence. Missing setup, permission/quota, schema, transport
or deadline failure remains BLOCKED; mocks and regex parser behavior do not satisfy
this gate. No credentials were requested or installed during this assignment.

## UX behavior requiring later validation

“What is inflation?” and other general financial education must work with no
account selection/consent and **zero financial tool/access-resolver calls**.
Personal requests such as “What did I spend last month?” must require authorized
scope and current tool facts. Keep the demo session boundary; account authorization
is distinct from authentication. Do not fetch/authorize accounts as a prerequisite
to the education path, including after a revoked/expired personal selection.

This is not verified by the present read API. At inspected #17, `model.ts` lines
22–23 explicitly put financial topics in `financial_read` and reject financial
assertions in general review. That broad rule may reject educational explanations.
Agent B must review/narrow classification and review policy in its owned files,
add scripted no-account education versus personal-query regressions, then verify
both using the genuinely configured model and integrated browser journey. Preserve
personal-fact grounding and payment protections. No B-owned edit was made here.

## Reproducible verification

Node 24.19.0, npm 11.9.0, Next.js 16.4.1, system Chromium. All databases, generated
passwords, logs and screenshots are temporary; no `.env.local` was created/shared.
Evidence directory: `/tmp/agus-integration-evidence/` (ephemeral, not a backup).

| Check                                                           | Actual result                                                                     | Evidence                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Clean `npm ci --cache /tmp/agus-integration-npm-cache`          | PASS, 247 packages                                                                | `npm-ci.log`                                  |
| Combined #13+#14+#15 `npm test` before integration tests        | PASS, 351 tests / 17 files                                                        | `combined-unit.log`                           |
| Opt-in clean database migration                                 | PASS, tables/seed initialized                                                     | `verified-migrate.log`                        |
| Final candidate `npm test`                                      | PASS, 362 tests / 19 files, 215.31s                                               | `verified-unit.log`                           |
| Final repository lint/typecheck                                 | PASS, both exit 0 (including restored next-env.d.ts)                              | `verified-lint.log`, `verified-typecheck.log` |
| Final production build                                          | PASS, exit 0; both API routes present                                             | `verified-build.log`                          |
| Existing authenticated fixture HTTP smoke                       | PASS                                                                              | `verified-http.log`                           |
| New production HTTP/browser/restart verification                | PASS                                                                              | `verified-financial-http-browser.log`         |
| All five unchanged browser suites                               | PASS, exit 0; 1440/820/390/320px journeys, bank retry and stale-editor assertions | `verified-browser.log`                        |
| Scoped formatting, diff, contract equality, protected ownership | PASS, protected paths and frozen contract unchanged                               | final diff/path checks                        |

Commands (use the supported runtime permission where required for subprocesses,
servers, Chromium and proxy access):

```sh
npm ci --cache /tmp/agus-integration-npm-cache
FINANCIAL_DEMO_ENABLED=true PAYMENT_MODE=fixture DATABASE_URL=pglite:///tmp/agus-verify-migrate npm run db:migrate
npm test
npm run lint
npm run typecheck
PAYMENT_MODE=fixture AI_PROVIDER=none NEXT_TELEMETRY_DISABLED=1 npm run build
npm run test:http
node scripts/verify-financial-integration.mjs
CHAT_SCREENSHOT_DIR=/tmp/agus-integration-evidence/chat UX_SCREENSHOT_DIR=/tmp/agus-integration-evidence/ux CONVERSATION_SCREENSHOT_DIR=/tmp/agus-integration-evidence/conversation DEMO_POLISH_SCREENSHOT_DIR=/tmp/agus-integration-evidence/demo npm run test:browser
git diff --check
```

Build before HTTP/browser checks; never build concurrently against their `.next`.
The new script uses port 3116, temporary ephemeral credentials, three sequential
production-server lifetimes and Chromium same-origin fetches. Existing scripts
use their own fixture databases. Full browser conversation tests mock the model.
Nothing here proves genuine inference, live bank access or real money movement.

Earlier failed development checks are not passing evidence: default npm cache
was unwritable; the clean `/tmp` cache install passed. PGlite rejected multi-statement
prepared DDL; initialization now executes individual statements. A stale-balance
test incorrectly assumed 24 hours had elapsed; an explicit later clock now tests
the unchanged withholding assertion. Scoped development lint found an unused
browser-global declaration and missing timer import; both were corrected. The
final run supersedes intermediate test/build runs after interface changes.

An overlapping preliminary full run timed out in unchanged `safety-restart`
reversal recovery and the new restart worker while another unit run, build and
browser job competed for resources. The duplicate unit/browser jobs were stopped;
their logs remain in `candidate-unit.log`, `overlap-unit-interrupted.log` and
`overlap-browser-interrupted.log`. Final checks run serially after build completion,
with the original timeouts, configurations and assertions intact. Interrupted or
timed-out runs are not included as passes.

## Remaining gates and exact next steps

1. Review this exact draft candidate independently, including session binding,
   composite constraints, context-CAS/expiry and consent/restart behavior. Keep
   draft; do not merge main or deploy.
2. Review #17, settle the educational-query policy with Agent B, then incorporate
   its B-only history on this integration branch. Run typecheck and direct adapter
   contract tests using B's actual ContextSchema/ContextStore, including restart,
   ambiguous follow-up, revocation and concurrent turns.
3. Configure legitimate private model access/egress above and pass genuine
   verification. This is the major end-to-end blocker.
4. Add the reviewed conversation route/composition and intent-only draft handoff;
   preserve existing draft verification, review, password approval and explicit
   submission. Wire the minimum functional UI before any later polish ownership
   transfer. Re-run all integration, payment, HTTP and browser checks.
5. If adopting #16, assign its distinct dataset manifest, reconcile actor/owner
   bindings and validate full executable records and independent arithmetic first.
   Keep its expectations separate from this seed. It is not required to seed the
   present foundation.
6. Obtain independent integrated grounding/security review and rehearse only the
   verified fictional demo before the October 22 deadline. Managed database,
   deployment, live banking, native speech services and production retention remain
   unverified/out of scope; no automatic work on them follows this assignment.

**INTEGRATION FOUNDATION COMPLETE.** The authenticated fictional read layer and
durable context seams are reviewable and tested. Genuine inference remains
`MODEL_NOT_CONFIGURED`; #17, education routing, conversation/UI composition and
independent integrated review remain outstanding. The integrated product is not
release-ready. Stop here; no merge, deployment, Agent B work or UI polish follows
automatically.
