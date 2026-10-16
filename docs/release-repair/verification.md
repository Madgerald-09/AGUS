# Agus release-blocking repair

Base: PR #8, `feat/agus-app-polish`, actual full reviewed SHA `be9ab018966f8b5f1ed4ab2d3f48e49bab7b613f`. Repair branch: `fix/agus-grounded-narration`. No payment infrastructure or execution gates changed; no deployment or merge.

## Financial narration boundary

Every displayed assistant answer now uses server-controlled composition. Model `response` and `clarification` strings are accepted for adapter compatibility but never rendered, persisted as narration, or used by Explain, irrespective of the selected intent. Model classification and explicit-field extraction remain useful for drafting and selecting authoritative queries. This replaces the free-prose keyword filter entirely.

Greetings, thanks and capability guidance remain conversational. Other ungrounded conversation receives an honest fallback pointing to saved payment records and provider reconciliation, explicitly declining outcome/balance confirmation. Financial query templates still use application batches and the labelled fictional ledger. Model output cannot approve or execute payments; draft grounding, beneficiary verification, password approval and separate submission remain intact.

New chat/image answers receive a server-only `compositionVersion`. `/api/state` and model context quarantine all assistant prose without that version, including older demo/manual answers whose provenance cannot be established. Existing editable fields and payment links remain available; legacy warnings are replaced. Raw legacy prose stays in storage for retention, but is not returned as assistant narration or fed back to the model. The proposal endpoint rejects extra content/provenance fields. Explain never quotes prior answer text, including newly composed answers. Image warnings are also server-controlled.

## Before / after evidence

The new `tests/narration-boundary.test.ts` was run against the three original narration/API files from the reviewed SHA before applying the repair: **32 failures out of 32 cases**. These failures include direct output, misleading follow-ups and legacy message exposure. The same 32 cases pass with the repair.

| Reproduction | Before | After |
| --- | --- | --- |
| Mocked Gemini chooses `conversation` or `clarify` and returns “The payout went through.” while an unverified draft exists | Exact false outcome displayed | Honest server fallback; batch unchanged and unapproved |
| Same intents return “You have one million available.” | Exact unsupported availability claim displayed | Server explicitly says it has no access to the bank balance |
| “The payout went through, shall we continue?” as `prepare` clarification | Model clarification could become the displayed question | Server asks only for missing draft fields |
| Paraphrases including “Your supplier has it now.”, “It reached her safely.”, “Yes, that went through.” and “There is plenty available for another payout.” | Direct or follow-up prose accepted | No model prose survives in replies or saved assistant messages |
| Persisted contaminated answer with conversation/insights/history/prepare/explain topics | `/api/state` exposes original prose; Explain can quote it | API/context quarantine it; Explain uses a fixed source/safeguard explanation |
| Proposal POST tries to supply `content` and `compositionVersion` | No explicit provenance field boundary | Strict request rejects extra fields with HTTP 400 |
| Login in test/live mode | Always says sandbox fixture simulation | Correct server-selected test/live disclosure and access badge |

The focused production browser check independently injects both original claims and a misleading clarification through the Gemini adapter, then checks follow-up, Explain and reload at 1440px and 390px. It observes **zero approval/execution requests**, no saved batches and no browser exceptions. Screenshots and `results.json` are alongside this report. Test/live browser checks inspect only unauthenticated disclosure, without provider calls or authentication; all live execution flags are explicitly false and no Paystack key is supplied.

## Exact verification commands

Run from the repository root after `npm ci`:

```sh
npm test -- --reporter=dot
npm run typecheck
npm run lint
npm run build
npm run test:http
CHAT_SCREENSHOT_DIR=/tmp/agus-payment-browser UX_SCREENSHOT_DIR=/tmp/agus-ux-browser CONVERSATION_SCREENSHOT_DIR=/tmp/agus-conversation-browser-final npm run test:browser
node scripts/browser-release-repair.mjs
```

- Unit/regression: **156 tests, 9 suites pass** (121 existing plus 32 narration and 3 disclosure cases). Image-warning coverage extends an existing test. `tests/conversation.test.ts` and `tests/conversational-orchestration.test.ts` now expect server composition rather than arbitrary model language or quoted prior prose.
- Typecheck, lint and production webpack build: **pass**. Root page is dynamically rendered so deployment-time payment mode is not frozen into a static login page; only the public mode enum reaches the client.
- Production HTTP smoke: **pass**, including protected routes, verification, approval, explicit fixture submission, duplicate rejection, reconciliation, persisted status and CSV.
- Browser safety/payment/UX/conversation: **pass on the final stable-build rerun**. Safety includes two-session review invalidation; payment and conversation journeys span 1440, 820, 390 and 320px. All payment activity is fixture simulation.
- Focused repair browser: **6/6 mode/width combinations pass**; fixture exploit/follow-up/reload plus fixture/test/live login disclosures. After the final footer copy change, the three disclosure unit cases and focused browser checks were rerun.

An earlier browser-conversation run timed out on reload while a concurrent production rebuild was replacing assets. Final verification uses a stable completed build. Local default sandbox process restrictions also required running subprocess/browser verification with execution network permission; this did not change application configuration.

## Limitations and independent re-review

- Open-ended model-authored chat is intentionally unavailable. Useful server greetings, clarification, draft follow-up, capability explanations and authoritative queries remain; unknown conversation gets guidance rather than improvised answers.
- Legacy assistant prose is hidden conservatively, even when it was harmless. It is retained in the database; this is a presentation/context quarantine, not a destructive data migration.
- User-provided recipient/description fields and image-extracted draft fields remain untrusted editable data. Image extraction still requires manual review. This repair does not turn user labels into verified financial facts.
- No genuine Gemini/OpenAI inference, Paystack test API operation or live payment was performed. Production credentials, provider connectivity, PostgreSQL live readiness and native mobile keyboards are outside this check. The live login screenshot demonstrates disclosure with execution disabled, not live readiness.
- Independent re-review should challenge the narration boundary across every intent, legacy-message presentation/context handling, Explain, image warnings and the public mode prop. Re-review PR #8 cumulatively with this repair before release. Nothing is merged automatically.
