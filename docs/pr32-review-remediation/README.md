# PR #32 independent-review remediation

Repair branch: `fix/agus-pr32-review-remediation-20261019`.
Base: actual PR #32 head `61c1add9f74b6562cd45800e4af815e42672b365` (verified through GitHub and fetched from `refs/pull/32/head`).
Draft PR must target `fix/agus-founder-financial-routing-20261019`.
The separate independent review report was unavailable; the six supplied findings were the specification. The review artifact was not modified.

## Six findings

| Finding | Root cause | Repair and evidence |
| --- | --- | --- |
| P1-01 calculator grounding | Numeric membership stripped signs and ignored currency, role, rate and time units; every historical user message supplied operands. | Bind operands to a bounded user grammar for NGN/kobo, income/savings/principal/target/start, percentages, annual interest and months. Match exact decimal integers, reject conflicting/negated/unsupported inputs, and ask a useful clarification. Only an explicit reference to the immediately preceding user figures permits reuse; no backwards search. Integer-kobo arithmetic and half-up rounding remain. |
| P1-02 last week | The rolling-seven-day branch also matched “last week.” | Resolve the previous completed Monday–Sunday week in Lagos from trusted server time. This week/month end at next Lagos midnight (exclusive). Past/last seven days include today and the prior six local dates, ending at that same exclusive midnight. Last month is complete. Boundary transactions demonstrate different weekly totals. |
| P2-01 rejection recovery | Recovery required a consumed approval, so a safe pre-claim rejection stayed globally locked. An unconsumed approval alone cannot distinguish rejection from in-flight work. | An additive audit receipt proves rejection of an exact execution attempt before claim. The one-use claim transaction refuses a previously rejected attempt, including concurrent replays. Recovery accepts only that receipt or an existing consumed claim; missing/stale state stays protected. Claimed pending/unknown/terminal outcomes retain the existing explicit provider/OTP controls and cannot resubmit. No automatic retry. |
| P2-02 historical paraphrases | “pay” questions were not recognized by the narrow historical grammar; model draft misclassification bypassed contextual account selection. | Recognize past-tense payment questions before imperative routing and share recognition with record detection. Mixed history/action requests clarify. Account selection resumes the exact original question through the existing owner/consent-checked read loop. |
| P2-03 voice overwrites suggestions | HTML readOnly did not stop suggestion handlers from changing the draft captured by voice start. | Disable suggestions during capture/transcription and guard programmatic composer changes with synchronous voice refs. Guard saved-question continuation/recovery too. The hook alone appends the transcript to the preserved draft; cancellation/error/navigation keep their existing epoch protection. Native recognition and MediaRecorder remain. |
| P2-04 Copy disclosures | CSS and rectangles alone did not represent closed-details visibility in a synthetic DOM. | Explicitly skip closed details at every depth, plus marked exclusions/redactions and payment internals. Preserve expanded prose and line breaks. Test optimistic synthetic geometry separately from Chromium DOM behavior; this does not establish an actual credential leak. |

All six findings are repaired for independent re-review. This report does not approve integration.

## Reproductions and regressions

Against the original reviewed head, the new calculator/date/routing and synthetic Copy tests produced **35 failures and 12 passes (47 tests)**. In particular, unrelated history and stale figures could produce the old interest result, invalid signs/units were accepted, and last week selected the rolling range.

Separate production-Chromium baseline runs reproduced the active voice suggestion and the rejected-payment lock: the suggestion-disabled assertion failed, and a confirmed rejection's error remained visible after saved-payment recovery. The repaired browser journey checks the same paths, including an explicit rejection caused by the fixture emergency gate, preserved nonce/references, and no automatic execution retry.

Added coverage:

- `tests/financial-agent/review-remediation.test.ts`: signed/negated values, currency and kobo, percent versus money, monthly versus annual rate and duration, role collisions, conflicting/missing/invalid model operands, savings constraints, exact decimal rounding and precision limits, explicit versus stale historical references, historical paraphrases and mixed intent.
- `tests/financial-agent/date-window.test.ts`: Monday/Sunday, week/month/year/leap-day boundaries, Lagos versus UTC midnight, and fictional transaction totals at inclusive/exclusive boundaries.
- `tests/copyable-message.test.ts`: synthetic closed/expanded/nested details, line breaks, hidden metadata, redactions and payment internals.
- `tests/payment-recovery.test.ts`: exact/stale/missing receipts, lost responses, repeated recovery and claimed pending/unknown/final outcomes.
- `tests/payments.test.ts`: persisted rejection, refusal to replay a rejected attempt, new explicit submission, uncertain claimed execution and owner isolation.
- `scripts/browser-chat-payments.mjs` and the mocked Gemini fixture: original account question retention, blocked suggestion clicks, actual and synthetic disclosure geometry, rejection recovery and existing lost-response/voice/navigation/payment journeys.

The former founder test expecting automatic reuse of an unrelated earlier income was updated to require explicit linkage. No tests were removed.

Browser harness investigation: receipts persist across viewport contexts, so a global count of one failed on the second width; the check now asserts one new receipt and one receipt for the current batch. An immediate post-Save button count also raced at 390px: the captured DOM already showed Needs verification and the saved ₦450 amount while the earlier count had seen the previous button. The harness now checks the `/edit` response has no approval and the correct amount, waits for matching `/api/state`, then waits for the old Submit button to detach. No sleeps or blind reruns were added. Final acceptance includes 320px.

## Validation

- Full suite: **901 passing tests in 40 files**, zero failures.
- Focused financial safety, ownership and integration: **339 passing tests in 11 files**, zero failures (`npm run test:integration`).
- Typecheck, ESLint, production build and `git diff --check`: pass.
- Production Chromium: **46 journey groups**, all passing at **1440, 820, 390 and 320px**. Zero page errors, horizontal overflow or automated WCAG A/AA violations in the checked workspace. Each width makes two explicit execute POSTs: one confirmed rejection, then one later submit. No automatic retry or duplicate replay.
- The final desktop run also invokes a suggestion synchronously inside `getUserMedia`, before React can disable the controls; the pending-permission ref preserves the blank draft.
- The initial sandbox denied subprocess execution in restart tests/build; checks passed with subprocess/network execution permissions. This was an environment restriction.
- Machine-readable results: [validation.json](validation.json), [browser-results.json](browser-results.json), [baseline.json](baseline.json).

## Changed implementation files

- Calculator/routing/date: `src/lib/financial-agent/{reasoning,agent,protocol,model,date-window}.ts`.
- Payment rejection proof/recovery: `src/lib/payments.ts`, `src/app/api/[...path]/route.ts`, `src/components/{payment-recovery.ts,conversation-payments.tsx,payment-ui.tsx}`.
- Composer/voice/Copy: `src/components/{financial-conversation.tsx,use-voice-input.ts,copyable-message.tsx}`.
- Tests and browser fixtures listed above, plus the adjusted `tests/financial-agent/founder-scenarios.test.ts` and this evidence directory.

## Limits and re-review focus

All financial data are fictional. Provider transport, Gemini, speech APIs and clipboard are mocked in browser acceptance; SQL/auth/payment routes are real local implementations. No genuine provider calls, live transfers, deployment or physical-device/microphone/OS clipboard tests were performed.

The operand grammar intentionally asks for clarification for unsupported phrasing, mixed currencies, non-month durations, unlabelled amounts, conflicting overrides and ambiguous/stale references. It does not silently convert monthly interest or infer cross-turn roles. Privacy-redacted historical amounts may need to be re-entered.

Re-review should concentrate on semantic binding/clarification and the persisted rejection receipt versus the one-use claim race. Legacy execution requests without an attempt receipt still fail closed on an unconfirmed response. No immutable payment or audit records were removed or rewritten; no authorization, digest, OTP, webhook, reconciliation or owner checks were relaxed.
