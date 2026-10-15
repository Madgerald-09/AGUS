# Five-minute fixture demonstration

Introduce: “Financial Agent carries a financial task from request through an independently checked outcome. Today’s workspace uses fictional accounts and simulated provider responses. No real money is moving.”

1. Sign in using the privately configured operator password. Point out the fixture badge and emergency stop.
2. Select “Prepare supplier payments” or enter “Pay my bills.” If no model key is configured, explicitly explain that this is the limited demonstration command parser. The real OpenAI/Gemini adapters are implemented but not active.
3. The agent asks who, how much, which bank and account. The inline proposal leaves these fields empty. Choose fictional Ada, enter ₦500, then add fictional Chidi with ₦700. Leave a field and refresh to show persisted edits. Use Ada at Wema `035 / 0000000001` and Chidi at Access `044 / 0000000002`. Save the two-recipient draft.
4. Stay in the conversation. Show the original-request label on the saved payment card. Verify beneficiaries. Explain that fixture-resolved names are not genuine Paystack verification; a configured test/live adapter calls the real account-resolution API.
5. Read both bank names, beneficiary names, accounts and amounts. Principal is ₦1,200. With default ₦50 per-payment estimated fee reserve, reviewed total including reserve is ₦1,300. Fees are estimates, not quotes. The initial ₦1,000 per-payment limit allows both payments individually.
6. Check the review checkbox and re-enter the operator password. Approve the batch. Show the separate submit action. Explain: chat cannot approve or submit.
7. Submit simulated transfers. Both show processing. Acceptance has not been called success.
8. Check provider. Ada becomes simulated successful; Chidi remains simulated processing. Show stored references, provider response records and the approval audit entry. No real receipt is generated.
9. Refresh. The job persists. Ask “What happened to those payments?” The response retrieves saved per-recipient statuses. Navigate to Activity, download CSV, and show the audit trail.
10. Show Insights: category totals, comparison with the previous week, largest expenses and ledger balances come from integer-kobo calculations over explicitly fictional transactions.

Optional: prepare reversal `058 / 0000000003` or failure `033 / 0000000004`; verify, review, authorize, submit and check provider. Toggle emergency stop before a new submission to demonstrate the server block.

If a model key is configured securely, show screenshot extraction using a fictional PNG/JPEG/WebP instruction. Review all extracted values in the form, including confidence warnings. Without a key, the attachment button explains the model requirement and offers pasted text or editable payment details; do not claim AI vision ran.

For a future genuine-transfer demonstration, stop at `LIVE_READINESS.md` first. A separately authorized business account, production access, funding, live webhooks, reconciliation and recipient-credit confirmation are required. Never flip live flags during this coding task or present fixture outcomes as real credit evidence.
