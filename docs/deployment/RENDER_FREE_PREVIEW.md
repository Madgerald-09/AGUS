# Deploy AGUS privately configured on Render Free

**Target:** a standalone `*.onrender.com` hostname. **Never enable real transfers.** This branch is derived from AGUS v1.2 candidate `5fc0eac18b8120eaa3457f855d4f153c4264350e`; `main` and draft PR #29 are not modified.

## Create the deployment

1. Sign in to [Render dashboard](https://dashboard.render.com/).
2. Select **New → Blueprint** and select the private GitHub repository `omnmlr/hackaholics-financial-agent`. Authorize the Render **GitHub App** for this private repository if prompted. Linking the Render app to ChatGPT is a different authorization and does not grant Render access to a private GitHub repo.
3. Set the Blueprint branch to **`deploy/agus-render-fixture-20261020`** and file to **`render.yaml`**.
4. Confirm that Render proposes these **two Free-plan resources**: web service `agus-hackaholics-fixture` and PostgreSQL `agus-hackaholics-fixture-db`. Do **not** approve paid resource upgrades or additional resources.
5. Enter private values at the initial secret prompt:
   - `AGUS_OPERATOR_PASSWORD`: a **new password at least 14 characters**, known only to you. It is hashed in memory at server startup; its plaintext is removed before the app child process launches.
   - `AI_API_KEY`: your legitimate Gemini API key. The app uses `gemini-3.5-flash-lite` as previously tested. If the key isn't entered, financial fixture screens still load but real AI chat reports model unavailable.
6. Approve Blueprint creation. The PostgreSQL database is provisioned automatically and its private connection string is wired into the web service by Render. Server startup runs the database initialization automatically.
7. Wait for the **Live** deployment status and open the actual `https://<hostname>.onrender.com` address from the web service dashboard. The login uses the password you supplied; internally, the operator identity defaults to `demo-operator`. Do not send passwords or keys via chat.

## Operational conditions

- Render Free web service sleeps after 15 minutes idle and can take roughly a minute to wake, including during demonstrations. Wake it before presenting.
- Render's **Free PostgreSQL expires after 30 days**, has no backups, and must be upgraded or migrated before expiry. This is **not** a durable long-term setup; avoid using real customer information.
- All accounts, transactions, transfers, evidence, receipts and amounts are **fictional/simulated**. `PAYMENT_MODE=fixture`, Paystack secret blank, and all live transfer flags false are enforced at **runtime** by `scripts/render-preview-start.mjs`. Do not remove these protections.
- The web service login page is publicly accessible by its `onrender.com` URL, but operator operations require your secret password. Share demo access only deliberately; free public hosting is not a private preview environment.
- `APP_ORIGIN` derives from Render's actual `RENDER_EXTERNAL_URL` and must match the address used for login; if you later add a custom domain, update this variable to the custom HTTPS origin.
- Database migrations run at each instance startup and use idempotent initialization. Do not run migrations concurrently from multiple processes.
- Render automatically assigns HTTPS. Neither `grindcity.app` nor any other custom domain is configured here.
- The private GitHub repository may require connecting/installing the **Render GitHub App** to authorize clone access in Render. This is separate from any ChatGPT Render plugin.

## Verification performed before deployment

GitHub Actions ran a production Next.js build, lint/typecheck, startup of `scripts/render-preview-start.mjs` using actual PostgreSQL 17, and HTTP readiness; **all passed**:
https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39383897840

This verifies the deployment **code path**, not a real Render-account deployment, real Gemini calls in Render, physical microphone or actual bank APIs.

## After startup

In fixture mode, select the fictional Amina account and verify these conversation prompts:
1. `What is inflation?` (real Gemini response if configured).
2. `What were the October 2026 spending and income totals for amina-current?`
3. `Find Ada payments on amina-current for October 2026.` then `The smaller one; show me its payment evidence.`
4. `Prepare a payment of 500 naira to Ada.` (editable review only; never real transfer).

Test reload persistence and voice input/output from your phone. Never claim that the assistant can debit Wema, ALAT, Paystack personal accounts or verify live bank credit until those APIs are genuinely integrated.
