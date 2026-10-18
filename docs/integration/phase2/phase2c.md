# Phase 2C conversational integration

18 October 2026, WAT. Draft integration only; no merge, deployment, real banking
or genuine model verification is claimed.

## Ancestry and scope

The isolated branch `integration/agus-phase2c-conversation` starts at PR #18,
`2283a7d2ae66821249183e0395646e14e3a9fbba`. PR #17 was inspected at
`043fa193bc362ae8504d9cd8a2c3b76520b590ee`. Its merge base with #18 is
`a60206657c9a57f58479cc2e08679a907813fe5f`, already present in #18.
Only the three B commits beyond that base were cherry-picked:

| Original B commit                          | Integration commit | Change                                             |
| ------------------------------------------ | ------------------ | -------------------------------------------------- |
| `d79b077568906cbe86f9480ebd07687fca9d4af1` | `b33a7f6`          | Isolated conversation engine, model adapter, tests |
| `38316bd1bf8e2523545968b7324fad5e9124caf7` | `e5f603b`          | Persisted selection validation before disclosure   |
| `043fa193bc362ae8504d9cd8a2c3b76520b590ee` | `8eee6f5`          | B handoff and model gate documentation             |

No PR #14 commits were replayed. Agent A contracts, tools, storage and financial
fixture data remain unchanged. B's module was reviewed for model/tool/deadline
bounds, strict schemas, permissions/revisions, deterministic financial rendering,
selection revalidation, scrubbing, CAS and payment intent isolation. The identified
education-policy issue is repaired here. This is an integration review, not an
independent production security certification.

## Application behavior

With `FINANCIAL_DEMO_ENABLED=true` and `PAYMENT_MODE=fixture`, the workspace links
to `/conversation`. Sign in through the existing workspace first. The page has
an optional account selector, plain-text conversation, a new-conversation control
and explicit payment-draft handoff. No visual redesign, dependencies or payment
policy changes were introduced.

`POST /api/conversation` accepts exactly `{ conversationId, text, accountIds }`.
The server requires the configured Origin, an authenticated operator session,
fixture opt-in, JSON content type, no query parameters and at most 16 KiB of
streamed input. Identity, permissions, tools, model adapters and clock cannot be
supplied by the client. Responses are private/no-store and simulation-labelled;
errors never contain raw model/provider exceptions.

The composition root injects B's actual configured OpenAI/Gemini adapter, A's
request-bound read dispatcher and fresh repository access resolver, and #18's
SQL `createContextPersistence` using B's actual `ContextSchema.parse`. Requested
account IDs confer no permissions. Personal planning checks account ownership,
active consent and source revision before receiving account context or issuing
tools, then rechecks access around I/O, model calls and persistence. Financial
answers still render only current authorized tool facts and source limitations.

`financial_education` is a distinct classifier route for impersonal financial
concepts. It needs no account grant and makes zero access-resolver/tool calls,
including after revocation of a previous selection. Generation receives no prior
financial history/selection. An independent structured review and lexical guards
reject personal claims, recommendations, product claims, credentials and payment
outcomes. Personal/mixed financial requests remain on the grounded read path.
The exact "What is inflation?" case and "Explain inflation to me" are covered.
Semantic behavior on a real provider remains unverified until model setup exists.

Context remains scoped by authenticated tenant/actor/conversation, with SQL CAS,
bounded scrubbed history and source-bound candidate selections. A browser tab
retains only the opaque conversation ID in sessionStorage. Reload starts a fresh
visible transcript but retains server follow-up context. No legacy ownerless
history is imported. Expiry is 15 minutes; an expired ID cannot reset to revision
1 and must be replaced using New conversation. Expiry is not physical deletion.
The authenticated read API is only fetched when the user requests accounts;
account loading/revocation failure does not block sending an educational question.

Payment preparation returns B's fixed intent handoff only. It does not mutate
workflow state or derive payment fields. Clicking Continue in payment draft sends
the original user text to the existing `/api/chat` workflow, then opens the payment
workspace. Its existing editable extraction, verification, review, password
approval and explicit submission remain authoritative. The conversation engine
cannot approve, execute, retry, verify or supply OTP. No payment modules are
imported into it, and handoff/model prose never becomes authorization.

## Verification

Final checks use Node 24.19.0, npm 11.9.0, Next.js 16.4.1 and system Chromium.
Logs and screenshots are ephemeral under `/tmp/agus-phase2c-*`.

| Check                                           | Result                                                                                                                  | Evidence                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Clean install                                   | PASS: 247 packages                                                                                                      | `/tmp/agus-phase2c-install.log`              |
| Final focused B/composition tests               | PASS: 106 tests / 6 files, 6.33s                                                                                        | `/tmp/agus-phase2c-focused-final.log`        |
| Full unit/regression suite                      | PASS: 468 tests / 25 files, 67.90s                                                                                      | `/tmp/agus-phase2c-unit-final.log`           |
| Repository lint                                 | PASS: exit 0                                                                                                            | `/tmp/agus-phase2c-lint-final.log`           |
| Typecheck                                       | PASS: exit 0; repeated after restoring generated next-env.d.ts                                                          | `/tmp/agus-phase2c-typecheck-restored.log`   |
| Production build                                | PASS: exit 0, both new routes present                                                                                   | `/tmp/agus-phase2c-build-final.log`          |
| Existing authenticated payment HTTP smoke       | PASS: verification, approval, explicit submission, duplicates and persisted outcomes                                    | `/tmp/agus-phase2c-http-final.log`           |
| Foundation read API HTTP/browser/restart checks | PASS: all 8 reported checks                                                                                             | `/tmp/agus-phase2c-financial-http-final.log` |
| New conversation HTTP/browser/restart journey   | PASS: all 13 reported checks, 1440/390/320px                                                                            | `/tmp/agus-phase2c-e2e-final.log`            |
| All five existing browser suites                | PASS: all five suites, exit 0; 1440/820/390/320px, bank retry, stale review and approval/submission separation          | `/tmp/agus-phase2c-browser-final.log`        |
| Genuine-model gate                              | BLOCKED: `MODEL_NOT_CONFIGURED`, exit 2, no inference attempted                                                         | `/tmp/agus-phase2c-model.log`                |
| Contract/protected paths/diff/format            | PASS: scoped Prettier and diff checks; contract, payment/auth/config, A implementation and foundation storage unchanged | Git comparison with #18 / contract baseline  |

Reproduction commands:

```sh
npm ci --cache /tmp/agus-phase2c-npm-cache
npx vitest run tests/financial-agent tests/financial-integration/conversation.test.ts
npm test
npm run lint
npm run typecheck
PAYMENT_MODE=fixture AI_PROVIDER=none AI_API_KEY= NEXT_TELEMETRY_DISABLED=1 npm run build
npm run test:http
node scripts/verify-financial-integration.mjs
node scripts/verify-phase2c.mjs
CHAT_SCREENSHOT_DIR=/tmp/agus-phase2c-evidence/chat UX_SCREENSHOT_DIR=/tmp/agus-phase2c-evidence/ux CONVERSATION_SCREENSHOT_DIR=/tmp/agus-phase2c-evidence/conversation DEMO_POLISH_SCREENSHOT_DIR=/tmp/agus-phase2c-evidence/demo npm run test:browser
NODE_USE_ENV_PROXY=1 PAYMENT_MODE=fixture node --import tsx scripts/verify-financial-model.ts
git diff --check
```

Run build and server/browser suites serially. Use the supported runtime permissions
for subprocesses, localhost listeners, Chromium and inherited network proxy access.
The new browser script uses port 3117, an isolated temporary database, ephemeral
operator credentials and three sequential production server lifetimes. Its preload
intercepts the genuine adapter's transport with explicit scripted responses. It
does not certify genuine inference. The real route has no scripted adapter mode.
The genuine-model verifier has no mocks and now includes education without an
account and personal-query account requirement in its twelve synthetic scenarios.

Development evidence is not counted as final passes: the first npm install used
an unavailable default cache; the clean `/tmp` cache install succeeded. A sandboxed
build failed to execute TypeScript config inspection; the supported subprocess
execution succeeded. Lint found a missing `clearTimeout` import in the new script,
which was fixed. The initial browser account-label selector was wrong and was
corrected to the stable account ID. An early full unit run was intentionally
interrupted when the education guards were tightened; only the final run counts.

## Model/network blocker and retained limitations

`MODEL_NOT_CONFIGURED` remains a real blocker to genuine inference. The selected
environment reports no secret bindings or model runtime variables. The preflight
reports provider `none`, model null and zero cases; no provider HTTP request is
attempted. The observed startup network allowlist also omits both official model
hosts. No failed provider transport call or successful model egress is claimed.
Configure an authorized private `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` and supported
egress to that provider's fixed host before running the genuine gate. Keep inherited
proxy/CA trust and `NODE_USE_ENV_PROXY=1`; never use a substitute public endpoint,
disable TLS or put credentials in chat, source or logs.

The end-to-end fixture journey can be verified independently of that blocker.
Simulation labels never certify live banking, recipient credit or money movement.
The foundation's limits remain: one configured demo operator, one Node process per
PGlite directory, no managed PostgreSQL/multi-worker durability proof, physical
retention/deletion/backup and real-data disclosure review outstanding. Extensive UI
polish and production readiness are deferred. Keep the PR draft; do not merge or
deploy automatically.
