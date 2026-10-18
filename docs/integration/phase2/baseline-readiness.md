# G0 baseline repair verification

Verification date: 18 October 2026 (WAT).

## Base, ownership and scope

- Branch: `fix/agus-baseline-readiness`.
- Isolated worktree: `/workspace/agus-baseline-readiness`; the original
  `/workspace/hackaholics-financial-agent` checkout stays clean on `work`.
- Base/dependency: Phase 1 commit `45f553177f86c2a40de6885304ed9bd47a5af5de`
  on `docs/agus-phase1-foundation-20261017` (PR #13), above main
  `a73d96c92d57df812485b66213689658e6c80391`.
- No `integration/agus-financial-memory` branch exists at verification time.
  The draft repair PR targets the Phase 1 branch, also used by PR #14.
- Repair implementation: `58f82cbcbf3640e272cc293d10e3bff29fafef1d`.
- Owned changes: remove tracked `.history/**` editor artifacts, ignore future
  `.history/` output in `.gitignore`, remove only the duplicate bank-loading effect
  from `src/components/dashboard.tsx`, and record this verification.
- Remote branch SHAs were captured before work and fetched again before editing
  and during verification. No concurrent branch changes or ownership conflicts
  were found. Gerald remains at `a52d9a1933f3db3c70887246100ba0c4df103e43`,
  already merged into main. Open engineering PR #14 changes only financial-data
  source/tests and its own handoff; it is neither imported nor edited here.

No payment, authentication, AI orchestration, financial-data, real-provider setting,
unrelated UI, dependency, lint configuration or test changes. Voice dictation,
recognition cleanup, editor versioning and stale-editor guards remain byte-for-byte
unchanged. No contract freeze or Phase 2 integration is declared by this repair.

## Reproduced before editing

Clean `npm ci --cache /tmp/agus-baseline-npm-cache` passed (247 packages).
The unchanged baseline production build passed before the browser reproduction.

1. `npm run lint`: exit 1, exactly three parse errors, line 235 of
   `.history/src/components/dashboard_20261016121434.tsx`,
   `dashboard_20261016121849.tsx` and `dashboard_20261016121900.tsx`.
   Each contains unresolved merge markers.
2. `DEMO_POLISH_SCREENSHOT_DIR=/tmp/agus-baseline-evidence/before-demo node scripts/browser-demo-polish.mjs`:
   exit 1, 30-second `locator.click` timeout at line 145 waiting for
   `Retry bank loading` in the first 1440px viewport. The existing request
   interception and assertion were unchanged.

The removed bank effect fetched on every snapshot while banks were empty,
independently of the existing authenticated `loadBanks` effect. Its failure went
to the generic error state; its competing successful request could hide the retry
state. A single authenticated loader now retains `bankError` until explicit retry
through the existing control. Empty-list validation and loading controls remain.

All six tracked history artifacts were reviewed against each other and actual
source: three conflicted dashboard snapshots, one intermediate dashboard snapshot
and two identical copies of the password-generation script. They are editor
artifacts; the current application and script retain the merged functionality.
Removing them fixes lint without excluding any application code from ESLint.

## Actual checks on the repair

Logs and screenshots: `/tmp/agus-baseline-evidence/` (local, ephemeral artifacts).
Node 24.19.0, npm 11.9.0, system Chromium 154.0.8037.57, Next.js 16.4.1.

| Check                                               | Actual result                                                   | Log                                    |
| --------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Clean `npm ci --cache /tmp/agus-baseline-npm-cache` | PASS, 247 packages                                              | `npm-ci.log`                           |
| `npm run db:migrate`                                | PASS, fixture PGlite schema/ledger initialized                  | `migrate.log`                          |
| `npm exec -- vitest run tests/demo-polish.test.ts`  | PASS, 30 tests / 1 file                                         | `unit-focused.log`                     |
| Unchanged `node scripts/browser-demo-polish.mjs`    | PASS, all four widths: 1440/820/390/320px                       | `browser-demo-after.log`               |
| `npm test`                                          | PASS, 215 tests / 11 files, 77.47 seconds                       | `unit-all.log`                         |
| `npm run lint`                                      | PASS, exit 0, no errors or warnings                             | `lint-after.log`                       |
| `npm run typecheck`                                 | PASS, including after restoring generated `next-env.d.ts`       | `typecheck.log`, `typecheck-final.log` |
| `npm run build`                                     | PASS, production webpack build, TypeScript and route generation | `build-after.log`                      |
| `npm run test:http`                                 | PASS, authenticated production fixture smoke                    | `http.log`                             |
| `npm run test:browser`                              | PASS, all five suites; four-width journeys complete             | `browser-all.log`                      |
| Diff, ownership and history-ignore checks           | PASS, scope/clean checkout/unchanged refs/ignore verified       | `ownership.log`                        |

Build and migration used process-local `DATABASE_URL=pglite:///tmp/agus-baseline-evidence/{build-db,migrate-db}`,
`PAYMENT_MODE=fixture`, `AI_PROVIDER=none`, empty model/Paystack keys and disabled
Next telemetry for builds. No `.env.local` was created or shared. HTTP/browser
harnesses generate their own temporary databases and ephemeral operator credentials.
Screenshot directories are redirected using `CHAT_SCREENSHOT_DIR`,
`UX_SCREENSHOT_DIR`, `CONVERSATION_SCREENSHOT_DIR` and `DEMO_POLISH_SCREENSHOT_DIR`.
Existing committed screenshots/reports are untouched.

The first normal-sandbox git fetch could not connect to the inherited proxy.
Fetch/install and subprocess/server/browser checks used the supported network
capability through that same proxy; no bypass or TLS changes. `gh auth status`
reported its environment token invalid; repository git fetch and connected GitHub
reads worked. The connected GitHub tool is used to open the draft PR.
Build-generated `next-env.d.ts` changes were restored; the final typecheck passed
on the committed version. No generated files enter the repair diff.

All checks in the table exited 0. The full browser command passed
`browser-safety.mjs`, `browser-chat-first.mjs`, `browser-chat-ux.mjs`,
`browser-conversation.mjs` and `browser-demo-polish.mjs`. The four-width journeys
completed at 1440/820/390/320px, including the formerly unreachable retry and
stale-editor assertions. The conversation suite uses a mocked model transport.
The focused rerun and full suite both use the existing unmodified browser scripts.

## Remaining limits and handoff

No baseline-repair check remains blocked or failing.

The focused browser test now reaches bank recovery, bank selection, separate
approval/submission, approval invalidation, stale-editor save rejection, loading
the latest draft, editor focus and layout at all four widths.
Native microphone permissions/speech services are not verified by headless
Chromium. Voice implementation is preserved by the minimal source diff.

Genuine model inference, Paystack/Wema/Mono access, managed PostgreSQL, hosted
deployment and real payments remain unverified and outside this repair. PR #14's
financial-data changes are not part of this branch's unit count or integration
claim. Contract acceptance, common integration-base freeze and later release
readiness remain separate Gerald/founder work. Keep the repair PR draft; do not
merge or deploy automatically.
