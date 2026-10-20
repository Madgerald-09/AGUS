# AGUS Phase 1 — Gerald's technical handoff

17 October 2026. **Read-only handoff until Francis approves the next workstreams.**
Baseline `main`: `a73d96c92d57df812485b66213689658e6c80391`.
Phase 1 branch: `docs/agus-phase1-foundation-20261017`. Use the final documentation
commit on that branch as the review reference; do not assume an old feature branch
contains the newest safeguards. Your PR #12 is merged, and `Gerald` has the same tree
as the audited main. No need to merge it again.

## What you are inheriting

The current app is a working **single-operator fixture workflow** with durable
messages/drafts and payment records. `payments.ts` owns verification, immutable
review/approval, one-use submission/OTP claims and reconciliation. `paystack.ts`
has both fixture and real REST transports; only fixtures/mocks were exercised in
this audit. `auth.ts` owns operator sessions, origin validation and reauthentication.
`db.ts` persists a revision-controlled singleton workflow JSONB plus sessions and
auth limits. Effects must stay outside replayable CAS reducers.

`intelligence.ts` calls OpenAI/Gemini for validated intent and untrusted draft fields,
or uses the labelled regex demo parser. Current narration is server-composed;
`conversation-policy.ts` prevents model claims from becoming financial facts.
`ai-inference.ts` has a bounded Gemini 503 retry; `ai-response.ts` validates the
provider envelope, completion and strict Zod result. Preserve those fixes. Connected
model configuration is not proof of successful inference.

`LedgerEntry` is a fictional signed-kobo demo ledger, not a bank transaction schema.
`banking-data.ts` has only a future interface. There is no account connection,
consent store, Wema/Mono implementation, vague transaction search, evidence service
or general AI read-tool loop. Current batch ownership filters do not establish
multi-user account isolation: ledger and legacy state are global.

Actual baseline checks: clean install, 215 tests/11 suites, typecheck, production
build and HTTP smoke pass. Lint fails on three tracked `.history` dashboard snapshots
with merge markers. The full browser command fails in its fifth suite at bank-loading
retry; the first four suites pass. See [READINESS_REPORT.md](READINESS_REPORT.md)
for precise limits; earlier root reports contain historical counts.

## Your first actions after authorization

1. Record the approved documentation SHA and recheck `origin/main` for newer work.
   Create the G0 cleanup PR first. Reproduce the three lint errors; inspect/remove
   accidental tracked editor snapshots and ignore future `.history/` artifacts.
   Also reproduce the fifth browser suite's missing bank-retry control; inspect the
   duplicate bank-loading effects restored in #12. Propose one coordinated loader
   retaining error/retry state. Preserve the test assertion, dictation and stale-editor
   protections. Do not change financial logic or hide lint failures in actual source.
2. Create the integration branch and ownership register in
   `docs/integration/phase2/gerald.md`. Freeze Agent A's contract-only commit with B
   before either implements incompatible interfaces. Put each worker in a separate
   worktree and use separate temporary databases/evidence directories.
3. Integrate new data under `financial-data/`, orchestration under `financial-agent/`
   and your seams under `financial-integration/`. Keep the payment aggregate/types
   and approval/submission routes separate. Your read route must derive principal
   from the existing server session, never a submitted actor/tenant ID.
4. Choose the first storage implementation: a scoped fictional read model and
   persistent context, with explicit account/consent grants. Reserve migration and
   package/config ownership to yourself. Agent A ships an injected in-memory
   repository; you wire PGlite/SQL and initialization, including new-table creation
   on a clean database, without changing payment reducers.
5. Validate model access only through a legitimate privately configured model key
   and supported egress. Keep `PAYMENT_MODE=fixture`, all live flags false, and
   synthetic input. Record provider/model/commit/time/schema/latency and safe IDs;
   no prompts, keys or raw financial/provider data in logs. Report failures honestly.
6. Integrate A -> dataset -> B, run acceptance gates, and declare a stable core SHA.
   Only then transfer dashboard/CSS ownership for final UI polish. Arrange independent
   review of the integrated candidate before recommending release to Francis.

## Commands and operating discipline

These are instructions for later approved work, not commands run by this document.
Replace `<approved-phase1-sha>` with the reviewed commit. Do not copy placeholder
credentials or production configuration into a shell.

```sh
git fetch origin
git worktree add -b integration/agus-financial-memory ../agus-integration <approved-phase1-sha>
cd ../agus-integration
npm ci
```

For private local fixture development follow README: copy `.env.example`, keep
`PAYMENT_MODE=fixture`, `AI_PROVIDER=none` initially, generate a password with
`npm run operator:password` in your private terminal, store only its salted hash
locally, then `npm run db:migrate`. Do not share the password/hash or `.env.local`.
Use durable disk with one PGlite server process. Set `APP_ORIGIN` to the exact local
or forwarded browser origin; do not weaken the origin check to make a preview work.

In this cloud environment use its permitted network capability, inherited proxy
and CA trust. A writable cache such as `/tmp/agus-phase1-npm-cache` is needed when
the home directory is read-only. External model/provider hosts need normal supported
egress configuration; never bypass the proxy or disable TLS. Native fetch behind the
proxy needs `NODE_USE_ENV_PROXY=1` on supported Node 24.5+ before starting the server.

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:http
CHAT_SCREENSHOT_DIR=/tmp/agus-chat UX_SCREENSHOT_DIR=/tmp/agus-ux CONVERSATION_SCREENSHOT_DIR=/tmp/agus-conversation DEMO_POLISH_SCREENSHOT_DIR=/tmp/agus-demo npm run test:browser
git diff --check
git status --short
```

Build before HTTP/browser checks, and do not run a concurrent build while browser
tests use `.next`. Inspect/restore generated `next-env.d.ts` changes if they do not
belong to your PR. Scripts use fixture credentials and temporary databases; mocked
Gemini browser transport is not genuine inference. They use ports 3100–3105 and 3107;
keep those free. Chromium is preinstalled here; elsewhere use README's supported
browser setup. Do not copy old passing artifacts into a new release report.

Before each integration, record `git diff --name-only` against the exact base and
review changes to protected files. Keep worker branches intact, integrate reviewed
commits and resolve conflicts explicitly with the owner. No force pushes over
another worker, shared worktrees or broad formatting commits. Re-run the complete
checks on the final integrated candidate; isolated worker passes are insufficient.

`npm run payments:reconcile` remains an existing **read-only provider verification**
operation. PGlite is single-process: do not launch a separate reconciliation process
against an open embedded database. Use in-server fixture checks for that demo or a
proper PostgreSQL setup for independent scheduled workers. Reconciliation cannot
resubmit unknown payments. This handoff grants no live execution authorization.

## Decisions you must record

| Decision    | Recommended October 22 default                                                                              | What remains unresolved                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Scope       | Fictional financial memory + existing supervised payment demo.                                              | Francis must authorize each workstream; no actual work launched by Phase 1.                                       |
| Identity    | One authenticated demo operator mapped server-side to one demo tenant and scoped fictional accounts.        | Real Personal/Business memberships, role delegation and recovery need later design.                               |
| Contract    | Accept v1 in `ARCHITECTURE_CONTRACTS.md`; A owns typed schema, you own integration changes.                 | Any amendment needs shared review/versioning before parallel implementation.                                      |
| Model       | Preserve intended provider/model; genuine synthetic verification is a release gate for connected-AI claims. | Legitimate key, supported egress, model access/quota/schema acceptance. Offline parser stays labelled if blocked. |
| Persistence | Separate accounts/consents/transaction/evidence/context tables; fixture adapter first.                      | Migration wiring, clean-db initialization, retention and deletion policy; managed PostgreSQL proof if available.  |
| Providers   | Unsupported Wema/Mono adapters report unavailable.                                                          | Official contracts, authorized sandbox access and real-data consent/revocation behavior. No credentials assumed.  |
| Responses   | Fact segments and approved connective language, preserving #9's grounding repair.                           | Freer financial prose requires separate evaluation and approval.                                                  |
| Release     | Last reviewed fixture commit, clear labels, rehearsed fallback.                                             | Hosting access, HTTPS/exact origin, backups, scheduler/webhook reachability and independent review.               |

If a required task touches the payment engine, document the proposed diff and why it
is necessary; do not implement it under these assignments. Preserve beneficiary
verification, snapshot digest, password/OTP, consumed claims, idempotency, small
limits, signed webhooks, mode isolation, uncertainty and reconciliation.

## Message Francis can send you

> Gerald, please review `docs/phase1/` on `docs/agus-phase1-foundation-20261017`, based
> on main `a73d96c92d57df812485b66213689658e6c80391`. Phase 1 is documentation only.
> Confirm the lint blocker from tracked `.history` files, the bank-retry browser
> regression, the single-operator/global
> data limits and the absence of genuine model/bank-data verification. Send me your
> review, proposed baseline-cleanup PR scope and any contract objections before we
> launch implementation. Once I authorize work, you own coordination and integration:
> freeze Agent A's data contract with B, keep workers in separate branches/worktrees,
> integrate deterministic fictional-data tools and grounded read-only orchestration,
> then run complete checks and obtain independent review before UI polish/release.
> Keep payments and live flags unchanged. Do not connect real accounts or assume
> Wema/Mono credentials. Our deadline is 22 October at 17:00 WAT; plan for a verified
> fixture demo if external model/provider access remains blocked.

See [WORKSTREAMS.md](WORKSTREAMS.md) for exact file ownership, branches, expected
outputs, acceptance gates, October 18–22 milestones and conditional November 6 scope.
