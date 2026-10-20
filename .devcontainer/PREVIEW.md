# AGUS v1.2 — private Codespaces preview

This branch is a throwaway browser-testing environment based on the verified candidate commit `5fc0eac18b8120eaa3457f855d4f153c4264350e`. It does not merge to `main`, submit payments, use real banking data, or deploy a public website.

## Start — no local installation

1. Open [Create AGUS preview Codespace](https://codespaces.new/omnmlr/hackaholics-financial-agent/tree/preview/agus-v1-2-codespaces-20261020). Confirm the branch says `preview/agus-v1-2-codespaces-20261020`, then choose **Create codespace**. Codespaces may count against your account's free usage allowance or incur usage charges.
2. Give the devcontainer a few minutes to install npm packages, create a fixture database, run migrations and start AGUS automatically. The **PORTS** tab shows **AGUS v1.2 private preview** on port 3000. Click its URL (or accept the prompted browser opening). **Keep port visibility Private**; use HTTPS.
3. In the Codespaces VS Code **Terminal**, run `cat .data/preview-login.txt`. This displays your Codespace-only randomly generated operator password. Sign in with that password. Do not share it.
4. The app is ready to test with fictional recipients/transactions. Reopen the port URL on your physical phone (signed into GitHub) to test mobile microphone, speech and touch behavior.

## Enable genuine Gemini conversations

The preview starts without Gemini if this Codespace has no existing **Codespaces** secret. **Actions secrets do not automatically carry over to Codespaces.**

**Lowest-friction way:** in the Codespaces Terminal run:

```bash
bash .devcontainer/configure-gemini.sh
```

Paste your Gemini API key at the hidden prompt. The key stays in ignored `.env.local`; it is not copied into Git or output to the console. **Stop and restart the Codespace once** so the server restarts with Gemini enabled.

Alternatively, create a repository Codespaces secret named `AGUS_GEMINI_API_KEY` (GitHub repository Settings → Secrets and variables → Codespaces) and restart the Codespace. The startup script also recognizes `GEMINI_API_KEY`, `AI_API_KEY` and `GOOGLE_API_KEY` as environment secrets. It does not print or write Codespaces secret values to disk. The configured model is `gemini-3.5-flash-lite`, matching the verified genuine-model gate; provider rate limits may apply.

## What to test

- Ask: **What is inflation?** and **If I save ₦70,000 monthly, how long until ₦1 million?**. Verify the first has a real Gemini response and that the second is clearly hypothetical (15 months without interest).
- Ask for **October 2026 spending and income for amina-current**. Correct fictional fixture totals are expenses **₦19,751.51**, income **₦250,000.00**, and difference **₦230,248.49**. The answer should disclose fixture-only/available-record limitations.
- Ask: **Find Ada payments on amina-current for October 2026.** Follow up with: **The smaller one; show me its payment evidence.** Require real evidence from a current read, not a claim of bank credit.
- Test new-chat microphone, start/stop, typing versus speech, transcription, sending after speech ends, listen-to-reply, clipboard and narrow mobile widths.
- Prepare two fictional transfers, verify beneficiaries, approve through the separate password-protected review, explicitly submit simulation, check statuses, then reload for persistence. **No live money moves**.
- Test logout, session expiry, account changes and rejection of attempts to approve transfers purely through conversation.

## Operational notes

- Startup enforces `PAYMENT_MODE=fixture`, `FINANCIAL_DEMO_ENABLED=true` and all live-transfer gates false; no Paystack key is installed.
- The project has an embedded PGlite database requiring a **single running Node server**. The preview script checks its PID to avoid duplicate startup; do not run a second app process against the same data.
- Private login details live in ignored `.data/preview-login.txt`, permission 0600. The database and `.env.local` are also ignored by Git.
- If startup fails: inspect `.data/preview.log` in Codespaces; the private preview is not a public production deployment.
- To avoid Codespaces usage charges, **stop/delete the Codespace** when you're finished. Deleting it also deletes the local preview database and password.
