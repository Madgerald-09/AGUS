# AGUS founder repair — intelligence, message actions and voice

Continuation branch: `fix/agus-founder-financial-routing-20261019`.
Parent: PR #31, `integration/agus-chat-payments-voice-20261019`,
`7e7fddf2cefcee64341a49ccef61098cf4acd56f`.
The dependent PR records the exact final implementation commit.

## Reproduced causes and changes

| Finding                                           | Cause                                                                                                                                                                                              | Repair                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money questions demanded an account               | A financial-keyword fallback forced general questions into reads; education treated possessives, “I earn” and “should” as personal-record requests.                                                | A separate reasoning route receives only unverified user statements. Explicit record requests retain authorization and grounding. The genuine conversational adapter remains in use.                                                                                                                                                |
| Hypothetical arithmetic                           | There was no account-free calculation contract.                                                                                                                                                    | Typed savings-goal, percentage-savings and simple-interest calculators accept sourced operands and compute in integer kobo. Model prose cannot provide competing numerical claims when a calculator is used. An independent review checks the complete answer and assumptions. Missing inputs prompt clarification.                 |
| Past-week/date friction                           | The deterministic resolver accepted explicit dates/months but rejected ordinary relative dates; the clarification exposed implementation language.                                                 | Resolve past seven days, last month, this month/week, today and yesterday from the trusted Lagos calendar. Display natural date clarification. Rolling seven days include today; this week starts Monday and runs through today. Existing explicit-date validation remains.                                                         |
| Account picker was disconnected from the question | A plain clarification offered no UI action.                                                                                                                                                        | A contextual Choose demo account action opens the existing authorized picker; Continue question resends the saved question without reconstructing it. An unsent composer draft is preserved.                                                                                                                                        |
| Musa/OPay/invalid account                         | OPay was missing from fixture institutions and grounding could accept a number substring; model extraction is not beneficiary discovery.                                                           | Retain recipient, bank and amount, discard invented conversions, require full-token account grounding and explicit mapping/result confirmation. Missing-account extraction notes open visibly. OPay is a labelled demo institution with **no invented Musa beneficiary**.                                                           |
| Sticky fixture error                              | The provider correctly rejected a number/bank pair absent from its four fictional beneficiaries. The hook ignored operation keys, stored one global notice and left it after a successful refresh. | Scope notices to the draft/batch/history. Check saved payments opens history and refreshes it. Clear obsolete notices after recovery, preserving the actual payment failure record. Suppress older refresh responses. Lost execution responses stay blocked until saved execution state is confirmed; no automatic transfer retry.  |
| Message Copy missing                              | Messages had no safe clipboard surface.                                                                                                                                                            | Hover/focus controls on desktop and visible touch controls copy rendered prose, line breaks and visible financial summaries. Exclude technical sources, hidden content, controls, payment-card internals and unrendered metadata. Announce success/failure; unsupported or denied clipboard access has a manual-selection fallback. |
| Recording conflict/clutter                        | The composer could change during recording; completion guidance persisted.                                                                                                                         | Lock and preserve the initial text during permission/capture/transcription; append a valid final transcript once, restore editing, and never auto-send. Clear transient guidance and reset on navigation. About voice stays collapsed in the footer.                                                                                |
| Recording visualization                           | Browser speech recognition exposes no stream. The recorder fallback already had an analyser but showed no measured level and depended on analyser setup succeeding.                                | Recorder bars use RMS from the **same existing stream**, with no additional audio upload or microphone session. Analyser failure does not block transcription. Native speech recognition uses an honest recording-status pulse, not a claimed measured waveform. Clean up streams, contexts, polling and duration timers.           |
| Brand/focus                                       | Expanded navigation lacked its wordmark; textarea and composer had stacked focus treatments.                                                                                                       | Move the original 64px asset into the expanded desktop sidebar; retain it in the main header when collapsed or narrow. Use one subdued composer focus boundary, preserving button and keyboard focus visibility.                                                                                                                    |

The payment engine, authentication, consent/ownership checks, approval digest,
one-use execution claims, OTP, webhooks, reconciliation and audit history are
preserved. No migration, production dependency, deployment or live transfer was added.

## Evidence

`baseline.json` and `baseline-sticky-warning.png` reproduce the original base in
an isolated worktree with mocked Gemini and fictional data: wrong fixture bank
rejection, global notice, ineffective recovery button, and notice on the welcome screen.
Before implementation, six of seven initial routing regressions failed.

Final command results and responsive journey groups are recorded in
`verification.json` and `browser-results.json`. Browser tests use production
Next.js, real local SQL/auth APIs and the fixture payment engine, with mocked
Gemini HTTP, speech recognition, recorder/analyser samples and clipboard access.
These are engineering checks, not live-provider or physical-device verification.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser:chat-payments
```

The browser command is self-contained: it generates ephemeral credentials,
isolates its database and disables live transfers. It exercises 1440, 820, 390
and 320px. It also drops execution/state responses, confirms submission remains
blocked, and recovers the same references without a duplicate execute request.

## Limits and deferred editing

- Zero genuine Gemini calls or live payments were used. Gemini behavior,
  physical microphones, OS clipboard permissions and audible synthesis require
  founder acceptance. Browser speech recognition may use the browser vendor's
  service; the existing recorder fallback uses the configured transcription
  provider. The privacy disclosure remains available.
- Native speech recognition has no safely accessible audio stream. It uses a
  recording pulse; measured bars apply to the existing recorder path only.
- Financial demo records and beneficiary outcomes are explicitly fictional.
  No Wema/Mono connection or real-account capability is implied. Unlisted OPay
  destinations intentionally fail fixture beneficiary verification.
- Calculators cover the three typed operations above. Other reasoning remains
  bounded model generation plus independent review; this is not a general math,
  rates, investment or tax engine. Ambiguous/unsupported dates or insufficient
  records require clarification. Partial records are labelled.
- Contextual account recovery uses the redacted saved question after reload.
  If sensitive long numeric input was redacted, the user may need to re-enter
  that part. Context is scoped to the existing bounded conversation history.
- Sent-message editing is deferred. A future Edit action should copy text into
  an unsent composer draft and create a **new immutable turn** linked to the
  original on explicit Send. Regeneration must create a new result, re-read
  current permissions/data, and never mutate existing payment instructions,
  approvals, references, outcomes or audit entries.

## Founder acceptance before October 22

Use the existing authenticated demo configuration with `PAYMENT_MODE=fixture`
and `FINANCIAL_DEMO_ENABLED=true`. For a limited genuine-model check, configure
the existing `AI_PROVIDER=gemini`, `AI_MODEL` and `AI_API_KEY` locally, then run
`npm run dev`; do not import the mock fixture transport. Keep live-transfer
switches disabled and never place credentials in screenshots or source control.

1. With no account selected, ask the millionaire question and the monthly
   ₦250,000 / 20% / six-month question. Expect 15 months with explicit full-saving
   assumptions, and ₦300,000 respectively. Ask for a budget and for hypothetical
   loan interest without its inputs; expect useful questions, no account demand.
2. Ask “How much did I spend in the past week?” Choose demo account, select an
   authorized fictional account and Continue question. Check the fictional and
   partial-record labels. Try last month/this week and ordinary conversation.
3. Ask the Musa/OPay/90991234AB question. Open the card: Musa, OPay and ₦500 should
   remain; the account stays blank with mapping confirmation guidance. Verify
   only a listed fictional beneficiary. Test a wrong number/bank pairing, change
   chats, then recover through Saved payments and correct the affected card.
4. Copy both sides of a multiline conversation. Paste into a plain-text editor;
   check line breaks, visible summaries and exclusion of technical payloads.
   Try denying clipboard permission and keyboard/touch access.
5. Type a draft, record speech, stop, edit the combined transcript, then Send
   explicitly. Cancel a second recording and deny access once. Confirm text
   preservation, controls unlocking, no late transcript after changing chats,
   and Listen/Stop playback. Judge actual microphone quality on your device;
   a native-recognition pulse is expected, measured bars on the recorder path.
6. Check sidebar collapse/expand and composer focus at desktop, tablet and phone
   widths. Confirm no duplicate wordmark, overlapping actions or horizontal scroll.
