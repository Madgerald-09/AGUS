# AGUS visual correction v1.2

Focused continuation of the existing visual revision at `6f4345a`, on `feat/agus-visual-v1-1`. This follows the [founder-approved v1.2 amendment to Issue #27](https://github.com/omnmlr/hackaholics-financial-agent/issues/27#issuecomment-6260321367) and the attached welcome concept. The PR #26 implementation was not restarted.

- Exact heading: **Let's talk money.** Exact placeholder: **Ask agus...**
- Original small wordmark beside the sidebar toggle; New Chat action at the right. No central logo or tagline, presentation border, caption, header profile or header sign-in action.
- Warm canvas `#131211`, composer `#201F1D`, raised surface `#292826`, subtle borders `#34312D`; AGUS Blue `#329BFF` Send with a contrasting dark arrow, including the empty welcome state. Empty, busy and unresolved submissions retain their existing disabled semantics.
- Three quiet chips: **Analyze spending / Track a payment / Prepare a transfer**. They populate editable drafts without sending or overwriting existing text.
- Account controls and operator sign-in are in the expanded sidebar/drawer footer. One persistent, discreet fictional-demo disclosure sits below the conversation/composer area. Necessary financial caveats remain contextual.
- The original JPEG and faithful exports are unchanged. The full lockup remains available for sign-in. No microphone or attachment functionality was added.

Financial facts, grounded narration, SQL history, financial authorization, payment review/approval/submission, recovery and emergency stop are unchanged. General conversation still works through the existing agent.

## Focused verification

Lint, typecheck, production build and the three existing login-disclosure tests pass. The two-width browser harness checks exact welcome copy, palette, blue Send with disabled behavior, header contents, chip editing without automatic sending, draft preservation, operator sign-in, history navigation, account access from the sidebar footer, exact spending figures, partial coverage, evidence and payment handoff/return. It uses mocked model routing/narration and real application sessions, SQL and fictional financial facts; it does not establish genuine-provider narration or physical-device keyboard/screen-reader verification.

Only the updated welcome screenshots are captured by `AGUS_CAPTURE_WELCOME=true node scripts/browser-visual-v1-1.mjs`:

- [Desktop · 1440×1000](welcome-1440.png)
- [Mobile · 390×844](welcome-390.png)

See `smoke-results.json` for the visual-stage run. The founder approved these v1.2 desktop/mobile welcome designs; the visual direction is frozen. The subsequent [composer behavior verification](composer-verification.md) records focused checks and fixes without additional media capture or redesign. No merge or deployment occurred.
