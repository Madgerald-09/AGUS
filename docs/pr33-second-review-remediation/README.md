# PR #33 second independent-review remediation

Founder summary: AGUS now refuses unsupported or unresolved calculator operands, sends clearly historical payment questions through authorized record reads even when the model proposes a payment draft, and blocks synchronous voice-start submissions without losing the draft or cancelling capture. This is a three-defect repair awaiting independent re-verification, not integration approval.

Reviewed parent: `efacb26a923d9436ffe0b18e2464312f8968d1f7` (actual PR #33 head verified through GitHub and fetched from its head branch). Repair branch: `fix/agus-pr33-second-review-remediation-20261019`. The dependent draft targets `fix/agus-pr32-review-remediation-20261019`.

The starting checkout was an older clean `work` branch; the repair branch was created directly from the verified PR head. `/workspace/agus-pr33-independent-review/REPORT.md` and its reproducers were unavailable. The exact findings in the request supplied the specification. No independent review artifact was modified.

## Root causes and repairs

| Defect | Root cause | Minimal repair |
| --- | --- | --- |
| P1 calculator units/corrections | The parser assigned months before validating percent/currency units. It silently discarded unrecognized numbers and percentages, permitting an old recognized rate to remain authoritative after a conflicting correction. Recognized but unused roles could also disappear. | Validate mutually exclusive units and compatible operand roles before assignment; reject unparsed numeric/unit fragments, unsupported operands, conflicting values and unused roles. Parse the complete original current instruction before disclosure scrubbing. The bounded grammar cannot prove correction supersession, so correction requests clarify and never calculate the older value. Preserve explicit linkage to only the immediately preceding user figures and exact integer-kobo arithmetic. |
| P2 historical payment routing | The historical grammar covered only a few pay/send forms. Model-proposed drafts bypassed the record workflow for transfer, passive-paid and check/whether questions; mixed requests were incompletely recognized. | Recognize high-confidence past questions and check/whether statements from the original instruction. Historical intent takes precedence over model payment routes. Additional action clauses in either order clarify. Existing permission-checked reads, contextual account selection, exact question continuation, date clarification and fictional-record disclosures remain. |
| P2 voice synchronous submission | `send()` consulted rendered `voiceBusy`, leaving a synchronous interval in which browser APIs had started capture but React had not disabled the composer. `discardVoiceCapture()` then cancelled capture and submitted/cleared the draft. | Check `voice.isVoiceLocked()` at the entry to shared `send()`, before every side effect. The existing recognition, recorder, permission and transcription refs are already initialized before their external API calls. Keep hook initialization, epoch checks, cleanup and unlock behavior unchanged. |

Corrections intentionally request a fresh complete set of explicitly labelled operands; this repair does not guess which value was superseded or convert monthly interest into annual interest.

## Reproductions

Before modifying production code, the first regression set produced 64 failures and 43 passes (107 tests) against the reviewed SHA. Separate production-Chromium probes reproduced synchronous submission from both `SpeechRecognition.start()` and `getUserMedia()`: each made one conversation POST before React rendered disabled controls.

The settled regression file was also run in an isolated detached worktree at the reviewed SHA: **87 failures and 58 passes (145 tests)**. This includes the original review cases plus additional incompatible-role and historical-question variations. Baseline failures are expected; they are not acceptance passes. The same 145 tests pass with the repair. See `baseline.json` and `validation.json`.

Coverage includes:

- `6% months`, percent-word durations, valid numeric/word/hyphenated six-month periods, currency/duration and percentage/currency collisions, principal/duration and principal/rate collisions, monthly versus annual rates, multiple rates, unrecognized numeric syntax, and incompatible unused operands.
- Both the stale and corrected model rate for an explicit 10% → 20% correction; income, savings and duration corrections; original instructions with figures hidden from the model by scrubbing; valid goals/totals/interest, kobo rounding and existing unrelated-history/explicit-linkage regressions.
- Did I transfer/send, have I transferred/made a payment, was/were paid, payment sent, has been paid, check whether/if, and historical transfer references. Model routes include `payment_draft`, `payment_action` and `financial_read`, with and without an account. Mixed requests in both orders clarify; genuine new-payment instructions retain their handoffs. Unauthorized account tests still block reads.
- Native and MediaRecorder startup probes invoke keyboard submission, the still-enabled Send button, and programmatic form submission inside the external browser API, before React rerenders. Blocked attempts leave the draft/history/pending state unchanged, make zero conversation POSTs and do not stop capture. Pending permission, active capture, transcription, cancellation, completion, deliberate submission, navigation and late callbacks are covered by the new and retained journeys.
- Production historical-question account selection continues the exact saved question through real local auth/SQL with deliberately incorrect model draft classification.

## Files changed

Production: `src/lib/financial-agent/{reasoning,protocol,agent}.ts` and `src/components/financial-conversation.tsx`.

Regressions/harness: `tests/financial-agent/second-review-remediation.test.ts`, `scripts/browser-voice-submit.mjs`, `scripts/browser-chat-payments.mjs`, `scripts/fixtures/gemini-chat-payments.mjs`, and `package.json` (include voice submission checks in the default browser command). Evidence is confined to this directory.

## Validation

- Full suite: **1,046 passing tests in 41 files**, including the retained 901-test baseline plus 145 new regressions.
- Focused calculator/routing/voice/recovery/Copy set: **658 passing tests in 18 files**.
- Existing integration/safety/isolation command: **339 passing tests in 11 files**. These sets overlap; their counts are not added to the full-suite total.
- Typecheck, lint, production build, formatting of changed code and `git diff --check`: pass.
- Final production Chromium: **50 integrated journey groups** (all original 46 retained plus four calculator groups), and **36 additional focused voice groups across eight runs**, all passing at **1440, 820, 390 and 320px**. Zero page errors, horizontal overflow or automated WCAG A/AA violations in the checked integrated workspace. Blocked voice attempts make zero conversation POSTs; each focused completion makes one deliberate submission. Integrated payment journeys make two explicit execution POSTs per width (confirmed rejection, then later authorized fixture submission), with no automatic retry.

Commands and counts are recorded in `validation.json`; responsive results in `browser-results.json` and `voice-browser-results.json`.

Browser harness failures were investigated before rerunning. Multiple new historical replies required selecting the last contextual account button. Desktop navigation exposed two New chat buttons, so the focused harness selects the last visible button. A cold initial unauthenticated refresh cleared the password entered before loading completed; the harness now waits for the composer to finish initial loading before entering credentials. None required product behavior changes or blind timing sleeps.

## Preservation and limits

The date-window implementation, payment rejection/recovery/one-use-claim architecture and Copy implementation are unchanged. Their existing regressions and integrated Chromium journeys remain in acceptance, including rejection receipts, lost responses, owner/permission isolation, calendar boundaries and closed disclosure privacy. No existing tests were removed or weakened.

Financial records are fictional; inference, speech, recording/transcription and clipboard are mocked. Local authentication, SQL and payment workflow routes run normally in fixture mode. No genuine banking operations, provider calls, live transfers, deployment or merge occurred. Physical microphones, real provider behavior and OS clipboard behavior require separate verification. The unavailable independent artifact’s separate 732 boundary comparisons and eight adversarial checks could not be rerun verbatim; repository boundary, recovery, race and isolation tests plus the retained browser journeys passed.

Independent re-verification should challenge operand rejection/correction semantics, historical/mixed routing with malicious model classification, and synchronous voice refs/unlocking. The grammar remains intentionally bounded and may clarify unsupported language. No integration approval is asserted.
