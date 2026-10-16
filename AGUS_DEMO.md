# Agus · Hackaholics 7.0 demonstration

Agus prepares a payment in conversation, gives the operator a clear review, and tracks each outcome. Authentication, verification, review acknowledgment, password approval and explicit submission remain separate requirements. The application uses the `agus.` identity from PR #7 throughout the authenticated workspace, built on the conversation work in PR #6.

## Prepare the demonstration

Follow the README's local setup and configure an operator password privately. Use `PAYMENT_MODE=fixture`; leave live-payment flags disabled. Run `npm run build` and `npm start` for the production presentation. Set `APP_ORIGIN` to the browser's exact origin. Use an isolated fixture database if you want a clean welcome; keep the existing database intact.

With `AI_PROVIDER=none`, the header says “Demo · no AI” and replies identify the demonstration parser. This mode supports the payment workflow without external dependencies. Natural conversation and image extraction require server-side OpenAI or Gemini configuration as documented in the README. Confirm a successful model-assisted response before presenting a connected AI experience. A configured provider alone does not establish a successful model call. Never expose credentials in the browser or recording.

## Five-minute walkthrough

1. Sign in. Show the `agus.` identity, simulation disclosure and focused conversation composer. On mobile, navigation is in the menu.
2. Send “Pay my bills”. Open the editable proposal. Show that Agus requests missing information and does not invent bank details. Choose fictional recipient Ada Okafor and enter ₦500; optionally add Chidi Nwosu for ₦700. Save the draft.
3. Open the linked payment card. Verify beneficiaries, inspect recipient names, bank/account, amounts and estimated fee reserves. A draft or chat reply cannot authorize money movement.
4. Acknowledge the review and re-enter the operator password. Approve, then select **Submit simulated transfers** separately. Show the simulation labels and check provider status. Ada succeeds while Chidi remains processing in this controlled fixture scenario.
5. Ask “What payments are still pending?” Show that unresolved outcomes remain unresolved. Reload to demonstrate persistence. Open payment history and Activity to inspect the saved records, references, statuses and audit trail; export CSV if useful.
6. Open Insights and point out the fictional ledger label. Return to the conversation. Show that Emergency stop remains available in navigation; sign out after the demo.

For a connected AI introduction, start with a greeting or a vague payment request and continue with missing details. Use fictional data. Provider errors remain explicit and do not silently switch to simulated model responses.

## Redesign scope

- Preserves the PR #7 login, password visibility toggle and authentication behavior; updates its remaining old brand label.
- Extends the wordmark, grayscale surfaces, typography, navigation and button treatment across the workspace.
- Gives messages clearer speaker labels, readable line spacing, calmer provenance badges and distinct user bubbles. Keeps operation-specific loading, errors, local pending input and the latest-message control.
- Reduces welcome suggestions to three; image attachment remains in the composer.
- Refines expandable drafts, payment forms, approval panels, status badges and tabular amounts. Successful and unresolved/error states remain explicit in text and icons.
- Keeps financial facts and payment-state handling on existing server paths. Activity counts all displayed saved transfers, including drafts, and labels fixture records “Simulation”.

## Verification scope and evidence

Production browser journeys cover 1440×1000, 820×900, 390×844 and 320×740. Checks include grayscale identity, viewport overflow, visible composer, draft persistence, beneficiary verification, password approval, separate submission, mixed outcomes, unresolved follow-up, secondary navigation and sign-out. Two-session checks ensure edited reviews invalidate acknowledgment and passwords. Keyboard-sized viewport, delayed/error response and long-conversation checks exercise existing request handling. Natural-conversation tests use a controlled mocked Gemini transport, not live inference.

Representative screenshots are in [docs/agus](docs/agus). Browser scripts accept `CHAT_SCREENSHOT_DIR`, `UX_SCREENSHOT_DIR` and `CONVERSATION_SCREENSHOT_DIR` to write fresh evidence outside earlier PR artifacts.

No production deployment, real transfer or genuine external-model request is included in this verification. Provider connectivity and event-time credentials must be checked in the intended demonstration environment. Independent review of this PR together with #6 and #7 remains required before release.

| Check | Result |
| --- | --- |
| `npm test` | Pass: 7 suites, 121 tests |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run build` | Pass: production webpack build |
| `npm run test:http` | Pass: isolated fixture server |
| `npm run test:browser` | Pass: safety, payment, UX and mocked conversation journeys across four viewports |
