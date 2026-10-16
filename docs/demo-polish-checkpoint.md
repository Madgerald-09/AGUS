# Agus final demo polish — Phase 1 checkpoint

Branch: `fix/agus-final-demo-polish`
Base: latest `main`, `96c1b56016291f7185d23959ebca4912798c89de` (merged PR #10).
Find the checkpoint commit with `git log -1 --oneline` on this branch.

## Implemented

- Natural greetings addressed to Agus, capabilities, thanks, casual conversation and contextual clarification. Displayed responses remain server-composed.
- Deterministic conversational corrections for institution, account, amount and recipient label. Single drafts are inferred only when unambiguous; multiple recipients or drafts require explicit selection. Selection survives follow-up edits and is invalidated when its saved details change.
- Institution names resolve against the active provider's returned bank list. No bank codes or account numbers are invented. OPay is supported when returned by that list; the existing four-bank fixture list remains intentionally limited, so OPay requests in fixture mode explain its unavailability.
- Saved drafts retain their batch identity; edits use the existing verification/approval invalidation path. Submitted and uncertain instructions remain immutable. Concurrent edits reject stale versions or proposal snapshots.
- Corrected conversations show one current payment card while retaining original request links. Recipient labels remain distinct from institution, account number and verified beneficiary name. The progress guide includes separate submission.
- Bank-loading failures appear in the editor with a retry action; unavailable selections retain their entered code visibly. Saving waits for a loaded institution list.
- Ledger summaries emphasize totals and leading categories with one sample-data label and an appropriate follow-up. Calculations remain server-grounded.

## Validation

- Full Vitest suite, typecheck, lint and production build: see the checkpoint report for final counts.
- `node scripts/browser-demo-polish.mjs`: Chromium at 1440, 390 and 320 pixels; real login, chat, institution changes, bank failure/retry, beneficiary verification, password approval, separate submission and invalidation on later edits. All payments use local fixtures; no submission is initiated.
- Browser screenshots default to `/tmp/agus-demo-polish/` and can be regenerated. Desktop and mobile captures were visually inspected.
- Gemini/Paystack live credentials are unavailable. Provider compatibility is covered by mocked tests, including the PR #10 regression suite; no live integration success is claimed.

## Resume after the usage reset

1. Resume this branch and inspect `git status` and this checkpoint; do not start over or reapply completed work.
2. Finish the focused visual pass: mobile payment-editor scrolling/height, long responses and conversations, navigation, narrow desktop, errors and saved outcome clarity. The editor remains tall on small phones even though overflow and composer-visibility checks pass.
3. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:http`, `npm run test:browser`, and `node scripts/browser-demo-polish.mjs`. Investigate failures; do not weaken auth or origin validation to make checks pass.
4. Use fixture mode and temporary databases/passwords for browser work. Existing scripts can write screenshots into tracked directories; direct them to `/tmp` using their screenshot-directory environment options and review Git status.
5. Review the final diff, commit remaining fixes, push this branch and open a PR targeting `main`. Attach the PR to the chat. Do not merge or deploy.

Environment note: `npm ci` needed `--cache /tmp/agus-npm-cache` because the default cache path is unwritable. The managed command runner required network-enabled execution for Git, builds and browser subprocesses; a restricted build returned empty output from a detached TypeScript child. The production build succeeded without changing application configuration.

Remotion, the completed film, production deployment, Render configuration, payment authorization flags, authentication and origin validation are untouched.
