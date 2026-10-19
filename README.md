# Agus — Hackaholics 7.0

Agus is a monochrome, chat-first Next.js financial workflow prototype: prepare payments, resolve beneficiaries, review and approve an immutable snapshot, explicitly submit individual Paystack transfers, and follow persisted outcomes. The agent never approves or executes payments.

**Default: fixtures. No real money moves. No live transfer was attempted or verified during implementation.** Real transfers can only come from an eligible, funded, authorized Paystack business account; this is not a way to debit arbitrary personal accounts.

## Run locally / in Codex Cloud

Node 22.16+ (Node 24 recommended), npm, writable project storage. No bank, model or database-server credentials needed for fixture mode.

```sh
npm ci
cp .env.example .env.local
npm run operator:password
# Put the generated salt:hash into OPERATOR_PASSWORD_HASH in .env.local.
# Keep the password privately; the app has no default password.
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and sign in with your operator password. For proxy-based Codex Cloud with Node 24.5+, set `NODE_USE_ENV_PROXY=1` before starting the server or reconciliation command; configure provider API egress through the environment’s supported configuration before connecting credentials. Preserve inherited proxy and CA settings. Set `APP_ORIGIN` to the exact browser origin, including scheme and port, if using a forwarded Cloud preview. Cookies become Secure for HTTPS origins. Never send keys or passwords through chat. `.env.local` and local database files are ignored by Git.

The password helper accepts a password of at least 14 characters in your terminal. Its prompt warns that input is visible; do not run it in a shared recording. It prints a salted scrypt hash, not the password. Sessions are opaque, stored hashed in PostgreSQL, expire after one hour, and are revoked on logout. Password reauthentication is required for approval and provider OTP finalization. Login and reauthentication share a database-backed ten-attempt / fifteen-minute limit.

Voice input uses the browser's microphone recording APIs and the server-configured OpenAI or Gemini provider for transcription. Tap to start; microphone noise suppression is requested where supported, recording stops after a pause or at 60 seconds, and the transcript is shown in the editable composer. The recording is sent to the configured AI provider for transcription and is not saved by the app; the provider's data policies apply. Spoken replies use browser text-to-speech and are opt-in, with a listen button on each assistant reply. Voice requests still use the existing financial chat safeguards: review the transcript and proposed payment details, then explicitly approve with the operator password. Voice never verifies, approves or submits a payment. Paystack-required transfer OTP remains enabled and cannot be bypassed.

## Database

Default `DATABASE_URL=pglite://.data/agent` runs persistent **embedded PostgreSQL** using PGlite and Drizzle. This development mode requires a single Node server process and durable local disk; do not use it on ephemeral or multi-instance hosts. Fixtures and history survive restarts. It is deliberately forbidden for live transfers.

For ordinary PostgreSQL:

```dotenv
DATABASE_URL=postgresql://user:password@host:5432/agent?sslmode=verify-full
```

Configure the deployment's trusted database CA and provider-recommended TLS settings; do not disable certificate verification. Run `npm run db:migrate`. The idempotent initial migration is `migrations/0001_initial.sql`; the application also initializes the same three tables. This MVP stores workflow aggregates as JSONB with revision-based compare-and-swap updates. See `ARCHITECTURE.md` for the scaling limit and normalized-schema follow-up.

All provider operations happen **outside** database reducers. Reducers may replay under contention. Never add external side effects to them.

## Demonstrate the workflow

1. Start in the full-screen conversation. Select “Prepare supplier payments” or type “Pay my bills”. The labelled demo parser asks who, how much, which bank and account; all missing fields stay empty.
2. In the inline proposal, explicitly choose fictional Ada (`035 / 0000000001`) and enter ₦500. Add Chidi (`044 / 0000000002`) with ₦700. Choosing a fictional recipient fills only the listed identity details, never an amount. Edits save when leaving a field and survive reload.
3. Save the draft. The linked payment card stays in the conversation with the original request. Verify beneficiaries, review names, accounts, amounts and fee reserves, check the review checkbox and re-enter your password.
4. Approve, then separately submit simulated transfers. Acceptance displays processing.
5. Click Check provider: Ada becomes **simulated successful**, Chidi stays **simulated processing**. Reload; both outcomes persist. Ask “What payments are still pending?” to retrieve saved outcomes and the unresolved-payment explanation.

The demo parser also supports the explicit single-recipient follow-up syntax `name: Ada; amount: 500`, then `bank: 035; account: 0000000001`. It retains the original request and never assigns ambiguous details across multiple recipients. Payment history, Activity and Insights are secondary navigation items. On mobile use the menu button; Sign out remains in the header.

Additional fixture accounts: reversal `058 / 0000000003`, failure `033 / 0000000004`. Only the listed bank/account combinations resolve. This whitelist is not a claim of real bank verification. No fake receipts are presented as evidence of a real transfer.

## Paystack test and live adapters

Set `PAYMENT_MODE=test` and configure a legitimate `sk_test_…` key through environment secrets to use actual Paystack REST APIs. Test-mode provider availability, account-resolution eligibility and transfer access depend on the business account. The app does not silently fall back to fixtures after an API error.

Implemented: banks (pagination), account resolution, recipient creation, balance, individual transfer initiation, OTP finalization and reference verification. Multi-recipient workflows coordinate individual transfers; the bulk endpoint is intentionally unused because its OTP requirement would conflict with preserving safeguards. Persistent references are generated before submission and reused for verification. No automatic POST retry exists.

Configure Paystack's webhook to `https://YOUR_HOST/api/webhooks/paystack`. Signature verification uses raw body bytes and the corresponding Paystack secret. Transfer webhooks atomically persist a deduplicated receipt and separate pending reconciliation work before independent reference verification; an event name alone does not declare success. Duplicate delivery can retry unfinished verification. Configure `PAYSTACK_INTEGRATION_ID` for live identity checks.

Run read-only reconciliation manually or from your deployment scheduler every minute:

```sh
npm run payments:reconcile
```

It verifies unfinished submitted transfers and pending webhook work, including reversal work whose last confirmed payment status is successful. It cannot submit or retry transfers. Pending work survives restarts and remains queued until verification confirms the event or a later terminal outcome supersedes it. In fixture mode it simulates verification. UI polling refreshes saved database state every 20 seconds; “Check provider” performs actual reference verification. Successful transfers can be rechecked manually and reversal webhooks trigger reconciliation. A missing webhook therefore requires an operational review of older successful transfers if reversal detection is needed.

**Do not enable live flags for a hackathon test without satisfying `LIVE_READINESS.md`.** All flags ship false. Amount limits are intentionally small: ₦1,000 per payment and ₦5,000 principal per batch. Fee reserves default to ₦50 per payment and are estimates, not confirmed Paystack pricing. Confirmed fees use integer-kobo `fee_charged` (or compatible `fees`) evidence, separate from the reserve. Adjust reserves after checking account-specific pricing and taxes.

## AI and screenshot extraction

```dotenv
AI_PROVIDER=openai
AI_API_KEY=YOUR_SERVER_SIDE_KEY
AI_MODEL=gpt-4.1-mini
# Or AI_PROVIDER=gemini and AI_MODEL=gemini-2.5-flash
```

Both adapters validate JSON against strict Zod schemas. The model classifies requests, extracts draft instructions, and may phrase a clarification question. Only deterministic server code produces financial summaries, statuses and payment actions. A bounded question filter rejects numeric or outcome-bearing clarification text; it is not a general-purpose model safety guarantee. Complete model-extracted text instructions may create **unverified drafts**. Missing fields return persisted, editable cards within the conversation; bank details are never inferred from a recognized name. Persisted messages and recent payment summaries supply context. The header distinguishes model configuration from a successful call; individual responses record model-assisted or demo-parser provenance. Provider failures are shown as errors, with no fake response or silent fallback. Real model connectivity was not tested in this credential-free environment. Model-classification requests receive recent messages and payment summaries; do not connect real customer data without reviewing your chosen provider’s data policy.

PNG, JPEG and WebP screenshots up to 5 MB are sent to the configured model for extraction. Files are not saved. Extracted fields and their image-source label persist in an editable conversation card; image contents cannot approve or submit a transfer. Do not upload real financial documents into this prototype without reviewing model-provider data policies. Configure a reverse proxy request-body limit of 6 MB as an additional production limit.

Seeded financial insights use fictional transactions; they do not represent Wema or personal bank account history. A future authorized banking-data source can implement `BankingDataSource` without changing the payout adapter.

## Checks and deployment

```sh
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:http # Starts a temporary fixture-only production server on port 3100
npm run test:browser # Two-session Chromium polling regression, fixture server on port 3101
npm audit --audit-level=high
npm start
```

`npm test` forcibly uses in-memory embedded PostgreSQL and fixture credentials. Provider REST tests use injected HTTP fixtures. No automated test calls Paystack or uses a production credential. The persistence and interruption tests use isolated temporary disk databases across separate Node processes. Browser tests use Playwright and installed Chromium (`CHROMIUM_PATH`, `/usr/bin/chromium`, or a Playwright browser installed with `npx playwright install chromium`). See `REPAIR_REPORT.md` for repair validation and limitations.

Deploy to a Node host supporting Next.js server routes and managed PostgreSQL, with HTTPS, a secret manager, an exact `APP_ORIGIN`, scheduled reconciliation, backups, and provider webhooks. This project has not been published or connected to a production account. Static export is unsuitable for these server-side payment endpoints.

See `ENGINEERING_HANDOFF.md`, `ARCHITECTURE.md`, `LIVE_READINESS.md`, `DEMO_SCRIPT.md`, and `TEAM_HANDOFF.md`.

See [CHAT_FIRST_REPORT.md](CHAT_FIRST_REPORT.md) for the experience changes, model/fallback boundary, verification results, screenshots and remaining P1 work.

The [P1 chat UX refinement report](CHAT_UX_REFINEMENT_REPORT.md) includes before/after desktop and mobile screenshots, request/error/scroll behavior, and keyboard verification limits.

## Hackaholics 7.0 integration

See [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for the conversational architecture, exact incorporated PR commits, financial authority boundaries, four-viewport evidence, limitations and genuine Gemini testing instructions. `npm run test:browser` includes the required conversation journey using a test-only mocked Gemini transport.

See [AGUS_DEMO.md](AGUS_DEMO.md) for the presentation walkthrough, redesign evidence and verification scope.
