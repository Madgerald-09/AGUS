# AGUS chat, payments and voice integration

19 October 2026. Parent: PR #30, `phase3/intelligence-verification-20261019` at
`a4927462b6394533aaf7d9797ac84c98c337457b`.
Implementation branch: `integration/agus-chat-payments-voice-20261019`.
No merge, deployment, live payment or genuine model request was performed.

## Architecture assessment

The approved `FinancialConversation` posts to `/api/conversation`, with owner-scoped
SQL chat history, general Gemini/OpenAI conversation and account-scoped financial
reads. Its model adapter, grounded narration, consent checks and tool boundaries
remain in place. The payment engine is a separate durable workflow aggregate behind
`/api/state`, `/api/proposals` and `/api/batches`: provider verification, revision
checks, digest-bound password approval, one-use submission, OTP, reconciliation,
webhook handling and audit history already existed.

The former handoff posted to the older `/api/chat` interface and navigated to
`Dashboard`. That mixed two conversations and required a second composer. Both
experiences used the same payment engine, so this migration reuses the existing
`PaymentEditor` and `BatchCard`, extracted to `payment-ui.tsx`, rather than replacing
payment logic. `Dashboard` remains unrouted source for compatibility and reference;
its payment controls and microphone now consume those same shared implementations.
Gerald's branch was neither fetched nor modified.

## Resulting flow

- `/` and `/conversation` render the approved AGUS conversation. The welcome,
  wordmark, palette, composer shape, Send button, focus visibility, saved chats and
  financial-response renderer are retained.
- A saved payment handoff offers **Prepare payment draft**. Its compact expandable
  card supports partial proposals, recipient/amount/description edits, multiple
  recipients, verification, explicit acknowledgment and password approval,
  separate submission, individual outcomes, OTP and read-only provider checks.
- **Saved payments** opens a disclosure within that same interface. It includes
  historical unlinked proposals and every owned batch, CSV export and emergency
  stop. `/?workspace=payments` and `/?fromChat=<uuid>` redirect into this history;
  the latter restores the originating chat. Existing backend endpoints remain.
- Chat transcripts deliberately redact long numbers. The handoff route retains
  the original request in the existing owner-scoped payment store, linked by chat
  and turn ID. Extraction uses that source, never an attempt to reconstruct a
  redacted account number. This does not change transcript redaction.
- `/api/conversation/payment-draft` validates the authenticated owner, same origin,
  bounded JSON input and an owned saved handoff. It commits a blank proposal before
  inference, claims it atomically, and reopens that proposal on repeat requests.
  The existing configured extraction adapter returns grounded editable fields
  only. It invokes no approval or execution tool and never uses the legacy fixture
  command parser. In-flight extraction cannot overwrite a changed/saved proposal.
- No transfer POST is triggered by rendering, reload, history, AI or polling.
  Polling refreshes saved state only. Failed/unconfirmed action responses refresh
  committed state; a failed refresh blocks further actions until state loads.
  Unknown/processing/submitted outcomes expose provider reconciliation on the
  original references, without a resend control. Password and acknowledgment state
  remount on review-digest changes. The backend remains the final authority.

## Voice and responsive behavior

`useVoiceInput` is extracted from the working dashboard capture implementation.
The icon-only microphone sits immediately before Send on the right. Stop commits
the transcript into the current editable draft, preserving text edited during
recording; cancel discards capture. Transcripts are never sent automatically.
Browser SpeechRecognition remains preferred; MediaRecorder plus the existing
`/api/voice` provider adapter remains the fallback. Tracks, audio contexts, request
aborts and callback generations are cleaned up on cancel, navigation, logout and
unmount. Permission failures preserve typed text. The 4,000-character composer
limit still applies. Interim recognition is committed on stop/end so it cannot
replace concurrent typing. Privacy/provider information remains in the collapsed
**About voice** disclosure; status text appears only during relevant interaction.

Assistant responses have individual Listen/Stop icons using browser speech
synthesis. No automatic playback preference is enabled or present in the composer.
Playback stops when sending, recording, changing chat, leaving the page or logging
out; callbacks from a previously active utterance cannot stop a newer one.

The existing desktop sidebar and modal drawer breakpoint are retained. Payment
forms use the conversation's scroll area and collapse to a single column on narrow
screens. No legacy dashboard shell or nested conversation scroll is mounted.

## Verification

Automated evidence uses fictional payments and mocked AI/speech. These results
are not physical microphone, audible speaker or genuine Gemini acceptance.

- Production build, TypeScript, ESLint and whitespace checks pass.
- Focused tests cover owned handoffs, concurrent/repeated draft preparation,
  redacted transcript versus payment source, failed extraction, edits during
  extraction and multi-recipient unknown-outcome recovery without resubmission.
- Full regression suite and browser results are recorded in `verification.json`.
- Production Chromium journeys run at 1440×1000, 820×900 and 390×844. They exercise
  general/educational conversation, authorized SQL totals, accepted mocked
  narration, ambiguous candidates, the three-tool historical investigation,
  proposal edit/reload, password review, invalidation after edit, separate fixture
  submission, lost submission response, reload and preserved recipient references.
- Speech mocks exercise start/stop/cancel, current typed text, late callbacks,
  MediaRecorder transcription, late permission, denial and request cancellation.
  Per-message playback, switching utterances, no automatic audio, navigation and
  logout are checked. Keyboard/IME, lost chat-response recovery, historical draft
  access, responsive overflow and automated accessibility are included.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, then
`npm run test:browser:integration` (or `npm run test:browser:chat-payments`). The
browser runner starts its own production server, temporary fixture database and
strict mock transport. It requires Chromium (`CHROMIUM_PATH`, default
`/usr/bin/chromium`) and emits `/tmp/agus-chat-payments-browser.json` plus screenshots
under `/tmp/agus-chat-payments-screens`. `test:browser` now selects this unified
suite. Older dashboard-specific scripts are retained under `test:browser:legacy`
as historical tests and are not current UI acceptance gates.

## Founder acceptance

1. Use an isolated local fixture database, `PAYMENT_MODE=fixture` and
   `FINANCIAL_DEMO_ENABLED=true`. Keep the founder's existing Gemini configuration
   and operator password setup; no new provider is needed. Build and start normally.
2. Check `agus.`, `Let's talk money.`, `Ask agus...`, saved chats and the composer at
   1440px, about 820px split-screen and 390px. Open and close navigation each time.
3. Send one ordinary greeting. For a focused narration retest, select the fictional
   Amina account and ask for October 2026 spending. This is optional and consumes
   model quota; the automated suite does not require a genuine-provider run.
4. Ask: “Prepare ₦500 for Ada at Wema Bank, account 0000000001, for lunch; and ₦600
   for Chidi at Access Bank, account 0000000002, for books.” Prepare/open the card,
   edit a description or amount, leave the field, and reload. Verify that edits and
   both recipients remain. Use only these fictional details.
5. Save, verify beneficiaries and review names/accounts/amounts/fees. Check the
   acknowledgment and approve with the operator password. Confirm no submission
   has occurred. Edit once to observe approval invalidation, then verify/review/
   approve again. Explicitly choose **Submit simulated transfers**.
6. Reload and use **Check provider**. Ada's fixture resolves successful; Chidi's
   remains processing. The same references must remain, without a second Submit
   button. Review historical drafts through Saved payments and an old payment URL.
7. Type a few words, record speech, stop and edit the resulting draft. Confirm
   nothing sends until Send is pressed. Test cancel, denied permission, new chat
   during capture, and mobile browser behavior on physical devices.
8. Click Listen under one response, click again to stop, switch responses, change
   chats and sign out. Confirm audio never starts automatically.

## Remaining limits

- Physical microphone quality, browser speech-service availability, audible
  synthesis and genuine-model extraction/narration require founder device testing.
  No genuine Gemini quota was consumed here.
- The existing conversation service still requires the fixture demo opt-in. Test/
  live payment APIs and recovery controls remain available to authenticated
  operators through Saved payments; this task does not enable live transfers or
  expand the financial data source beyond fixtures.
- Redacted handoffs created before this integration have no retained original
  source. Missing account numbers must be entered manually. Never guess them.
- An interrupted/failed extraction leaves a saved blank card for manual completion;
  reopening does not retry inference. A crash between saving a chat turn and its
  payment source can likewise require manual completion. No payment is submitted
  by either operation.
- The existing shared operator identity, aggregate-storage scale limits and
  single-process durable PGlite requirements remain. An uncertain submission can
  require operator investigation; it must never be recreated or resent merely
  because verification cannot find a transfer.
