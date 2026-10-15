# Engineering handoff — 15 October 2026

Implementation is in this repository. No production account was connected, no site was deployed, and no real-money operation occurred.

## Completed

- Next.js 16 App Router, React, TypeScript, Tailwind, server-side routes and a responsive operator workspace.
- PostgreSQL schema/migration with Drizzle; persistent embedded PostgreSQL for credential-free single-process development, managed PostgreSQL adapter for deployment.
- Server authentication with salted scrypt password verification, hashed opaque sessions, exact-origin checks and persistent login/reauthentication throttling.
- Real Paystack REST adapter for banks, beneficiary resolution, recipient creation, transfer balance, initiation, OTP finalization and reference verification. A separate clearly labeled fixture provider remains the default.
- Single and multi-recipient drafts; provider-resolved review cards; password-reauthenticated approval with a digest, snapshot, expiry and one-use nonce; immutable submitted instructions.
- Atomic execution claims, concurrent balance reservations, no automatic retry of ambiguous transfers, per-payment/batch limits, strict live allowlist and emergency switches.
- Processing, OTP, successful, failed, reversed and unknown outcomes; signed/deduplicated webhooks, persistent response records and audit trail, manual and scheduled read-only reconciliation.
- OpenAI and Gemini structured-intent adapters; persistent conversation; backend-generated status/spending answers; unverified draft creation only. With no key the limited command parser is explicitly labeled as demonstration behavior.
- Screenshot extraction adapters returning editable untrusted proposals, field/confidence warnings, bounded requests and file validation. Images cannot approve or submit anything.
- Fictional Nigerian ledger, integer-kobo category/weekly/monthly calculations, largest expenses, recurring entries, sample obligation, transaction history and CSV export.
- `.env.example`, README, architecture, live readiness, demonstration script and independent Gerald tasks.

## Actual verification results

| Command                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                     | **38 tests passed**, 2 test files. Covers validation, money, beneficiaries, approval and modification, insufficient balance, concurrent duplicate execution, cross-batch reservations, unique references, provider REST contracts, response handling, OTP, signatures, replay, pending/success/failure/reversal/unknown, persistence across Node process restarts, auth and throttling, invalid AI output, untrusted-image boundaries, CSV and deterministic insights. |
| `npm run typecheck`            | Passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run lint`                 | Passed, no warnings or errors.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run build`                | Passed: optimized Next.js production build, TypeScript checking, static root page and dynamic server API route.                                                                                                                                                                                                                                                                                                                                                        |
| `npm run test:http`            | Passed against the built production server: login, unauthenticated-route rejection, two-recipient preparation, beneficiary verification, password approval, explicit submission, duplicate rejection, provider reconciliation, persisted-status conversation and CSV download. Uses temporary fixture storage and ephemeral test credentials, then stops the server and removes the database.                                                                          |
| `npm audit --audit-level=high` | **0 vulnerabilities** in the resolved dependency tree after updating the initial framework/ORM/test tooling.                                                                                                                                                                                                                                                                                                                                                           |

No automated test calls Paystack or a live model. Provider responses in tests are fixtures. No live-money transfer or actual recipient credit is verified. Browser interaction and visual screenshot QA were not run; HTTP behavior and compilation were checked. A separate PostgreSQL server connection was not available; SQL behavior and disk persistence were tested with embedded PostgreSQL.

## Start here

Follow `README.md`: install dependencies, copy `.env.example` to `.env.local`, privately generate an operator password hash, initialize the database, then run the dev server. The application intentionally has no default operator password. The default fixture workflow needs no banking or model key.

`DEMO_SCRIPT.md` demonstrates Ada's simulated success and Chidi's simulated pending transfer, persistent history after refresh, and deterministic insights. Use `TEAM_HANDOFF.md` to assign isolated frontend, reporting, reconciliation-summary or insight-filter work to Gerald.

## External blockers and next steps

1. Configure an existing-model key privately if full conversation and screenshot extraction are needed. The adapter exists; actual model connectivity and image accuracy are not verified.
2. Obtain legitimate Paystack test-account access and run account-level integration tests. API contracts were checked in current official documentation, but test-account eligibility, funding, OTP behavior and real provider responses remain external validation work.
3. Configure supported egress for `api.paystack.co`, the chosen model API and the database through the environment's normal configuration workflow. This Cloud environment initially exposes package-host egress only. Do not bypass the session proxy or disable TLS verification.
4. In proxy-based Codex Cloud, use Node 24.5+ with `NODE_USE_ENV_PROXY=1` set before launching the server or reconciliation command so native fetch uses the inherited proxy. Preserve the injected CA trust. Direct PostgreSQL connections require the environment's supported TCP access, or use embedded PostgreSQL for fixture development.
5. For any future genuine-transfer demonstration, complete every separate state in `LIVE_READINESS.md`. This coding task grants no production activation permission. All live flags remain disabled in the example configuration.

## Deliberate MVP limits

One business-account operator; no multi-tenant roles or MFA. Workflow records are a revision-protected singleton JSONB aggregate, suitable for a small demonstration but requiring normalization/indexing for volume. Audit history is append-only in application logic, not tamper-proof against a database administrator. Embedded PostgreSQL requires a single process and durable disk and is forbidden for live mode. Managed deployment, backups, scheduler monitoring and security review are not completed here.

Fee reserves are configurable estimates, not provider quotes. Confirmed charges are shown only when returned by Paystack. Batches are coordinated individual transfers and can finish partially; there is no cross-recipient financial rollback. Unknown or interrupted submissions require reference reconciliation and possibly human investigation, never an automatic replacement transfer. Reversal webhooks and manual rechecks cover earlier successes; the default scheduled job checks unfinished transfers only.
