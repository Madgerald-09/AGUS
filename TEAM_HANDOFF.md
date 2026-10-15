# Independent tasks for Gerald

Keep the established server authorization boundary. No task requires a core architecture redesign. Lucy can use `DEMO_SCRIPT.md` and the explicit fixture/live distinction in pitch materials.

## 1. Improve editable recipient validation and accessibility

Files: `src/components/dashboard.tsx` (Row form and modal), `src/app/globals.css`.

Contract: POST `/api/batches` with `{payments:[{name,bankCode,accountNumber,amountKobo,reason}]}`; banks from GET `/api/banks`. Account numbers remain strings, amountKobo is a positive integer. Editing uses POST `/api/batches/:id/edit` and invalidates prior verification/approval.

Acceptance: field-specific error messages; preserve entered data on server rejection; focus initial field on modal open and restore focus on close; trap focus inside the dialog; Escape closes only when safe. Do not change approval or transfer logic. Distinguish provider-resolved name from user label.

Tests: keyboard-only form navigation, failed-save recovery, leading-zero account preservation, positive amount with two decimal places, narrow-screen layout. Add browser tests only once the team's browser harness is available.

## 2. Improve report filtering without changing raw financial values

Files: `src/lib/intelligence.ts` (`exportPaymentReport`), `src/app/api/[...path]/route.ts` (reports GET), `src/components/dashboard.tsx` (Activity).

Contract: keep `/api/reports` authenticated and existing CSV columns stable. Add optional validated ISO date and status filters. Preserve integer kobo, environment column, formula escaping and exact references.

Acceptance: UI date/status selection matches exported records; fixture/test/live rows remain clearly identified; unsupported filters return 400; no sensitive unauthenticated download.

Tests: range boundaries in Africa/Lagos, status filters, CSV quoting/formula injection and unauthorized requests.

## 3. Reconciliation operations summary

Files: `scripts/reconcile.ts`, `src/lib/payments.ts` (read-only reconciliation only), new tests alongside `tests/payments.test.ts`.

Contract: `reconcileBatch(actor,batchId)` makes GET verification calls; it must never call `executeBatch`, provider submit or provider finalize. Preserve unknown results and consumed approvals.

Acceptance: summarize counts of checked, resolved, pending and unknown records without logging full accounts, credentials or OTPs; fail observably for scheduler errors. Add an optional dry-run listing of references needing checks.

Tests: injected provider timeout, not-found reference, pending-to-success, partial batch, reversal event, repeated execution of the reconciliation job causes zero transfer POSTs.

## 4. Extend spending exploration from the demo ledger

Files: `src/lib/intelligence.ts` (`analyzeSpending`), `src/components/dashboard.tsx` (Insights), `tests/payments.test.ts`.

Contract: `LedgerEntry.amountKobo` is signed integer kobo; positive credit, negative debit. This is fictional data; retain the notice. No AI arithmetic.

Acceptance: merchant/category selection, date range, recurring-expense grouping; totals exactly match filtered ledger; period definitions are displayed. Keep real account-data aggregation out of scope.

Tests: no transactions, credits only, month boundary and consistent category/expense totals.

## Work discipline

Use feature branches with small commits. Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Do not put credentials in source, enable live flags, disable provider safeguards, or add approval/execution operations to AI tools. Ask the founder for UI direction, not payment-authority changes.
