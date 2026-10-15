# Live readiness — disabled

These are separate states. Passing fixture tests does not establish provider access, production authorization, settlement, or recipient credit.

| State                                     | Evidence / current result                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code implemented                          | Real Paystack bank, resolve, recipient, balance, initiate, finalize and verify adapters; reviewed approval, limits, allowlist, emergency stop, signed webhooks and reconciliation. |
| Tests passed                              | See `ENGINEERING_HANDOFF.md` for actual command results. Test HTTP responses are fixtures, not live provider evidence.                                                             |
| Provider access obtained                  | **No.** No legitimate Paystack account was connected in this workspace.                                                                                                            |
| Live credentials configured               | **No.** No production key was supplied or requested.                                                                                                                               |
| Production authorization received         | **No.** This coding task explicitly excludes activation and real-money operations.                                                                                                 |
| Genuine transaction successfully executed | **No.** No real-money transfer was attempted.                                                                                                                                      |
| Actual recipient credit confirmed         | **No.** No recipient-bank evidence exists.                                                                                                                                         |

## Activation prerequisites — legitimate owner to complete separately

1. Verify Paystack business eligibility and Transfers enablement; obtain documented account-owner permission and approved secret-manager configuration. Understand account-specific test/live availability and any Paystack compliance requirements.
2. Deploy on HTTPS with exact `APP_ORIGIN`, managed PostgreSQL and durable backups. Configure a strong operator password privately; restrict operator access. Review stronger authentication before anything beyond a supervised limited demo.
3. Configure matching `PAYMENT_MODE=live`, a legitimate `sk_live_…` key and exact `PAYSTACK_INTEGRATION_ID` via deployment secrets. Never place credentials in source or chat. Test and live records are separate environments; old approved test batches cannot be submitted live.
4. Configure a strict `LIVE_BENEFICIARY_ALLOWLIST` of exact `bank_code:account_number` pairs for independently agreed recipients. Resolve and review provider names; beneficiary labels are not verification evidence.
5. Set conservative integer-kobo limits for principal per payment and batch. Check actual Paystack fees/taxes and adjust `FEE_RESERVE_KOBO`; the displayed reserve is not a binding provider quote. Fund sufficient business transfer balance.
6. Validate webhook reachability, matching secret, exact-byte signatures, duplicate deliveries, delayed/out-of-order events and independent transfer verification in the legitimate test environment. Then record `LIVE_WEBHOOK_VALIDATED=true` only after validating the live webhook configuration with the account owner.
7. Configure and monitor `npm run payments:reconcile` on a scheduler. Verify unknown/pending cases survive restarts and receive operational attention. Record `LIVE_RECONCILIATION_VALIDATED=true` only after operational validation. Test emergency disabling. Do not depend solely on UI polling.
8. Preserve Paystack transfer OTP/approval safeguards. The code supports explicit OTP finalization and never disables OTP. Confirm account-specific authorization behavior with Paystack.
9. Only after owner approval, set `PAYSTACK_TRANSFERS_ENABLED=true`, `LIVE_OWNER_AUTHORIZED=true`, and finally `LIVE_TRANSFERS_ENABLED=true`. Keep `PAYMENTS_EMERGENCY_DISABLED=false` only for an authorized supervised session. Runtime gates cannot independently certify account verification; these flags are operator attestations, not proof from Paystack.
10. For the first separately authorized small live transfer, resolve the allowlisted recipient, review all fields, reauthenticate approval, explicitly submit, provide any legitimate OTP, independently verify the reference, and have the recipient confirm actual bank credit. Record those evidence states separately. No automated test may initiate this step.

## Uncertain or interrupted transfers

Do not press submit again or create a replacement merely because the network failed. Submission claims are permanently consumed. Reconcile the persisted reference. Preserve unknown if verification fails or returns no match; investigate through the legitimate Paystack dashboard/support before any separately reviewed replacement. A partial batch can contain success, processing and failure simultaneously.

## Operational limitations

No live or provider-sandbox connectivity was available during development. Complete account-level integration tests before activation. Current storage is a globally serialized JSONB aggregate suitable for the small MVP, not high transaction volume. There is one operator, no MFA or tenant separation, and application audit records are not tamper-proof against a database administrator. No external security review, penetration test, disaster-recovery drill or production hosting validation has occurred. Use the readiness gates and documented evidence; never present fixture screenshots as proof of payment.

## Official API contracts checked during implementation

- https://paystack.com/docs/api/transfer/
- https://paystack.com/docs/api/transfer-recipient/
- https://paystack.com/docs/api/transfer-control/
- https://paystack.com/docs/api/miscellaneous/
- https://paystack.com/docs/identity-verification/verify-account-number/
- https://paystack.com/docs/payments/webhooks/

Checked 15 October 2026 through official documentation. Recheck account-specific pricing and operational behavior before enabling credentials. No live claims derive from reading documentation.
