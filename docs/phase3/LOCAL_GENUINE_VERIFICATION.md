# Bounded genuine verification — Windows Git Bash

Run from the repository using Node 22+ and the founder's existing private `.env.local`.
It must already contain `AI_API_KEY` and, for the application, the existing operator password hash.
Do not print the file, export a browser HAR, paste credentials, or commit local response outputs.
The commands below use fixture records and an isolated local database. Environment prefixes override any live settings in `.env.local`.

## 1. Exact source and inexpensive checks

```bash
git fetch origin phase3/intelligence-verification-20261019
git switch --track origin/phase3/intelligence-verification-20261019
# If that local branch already exists, use: git switch phase3/intelligence-verification-20261019
git rev-parse HEAD
npm ci --no-audit --no-fund
npm test -- tests/financial-agent
npm run typecheck
npm run lint
node --import=tsx scripts/verify-financial-model.ts --list
mkdir -p .data/phase3-results
```

The private environment stays on this machine. `--list` makes no provider calls.
Check current Gemini limits in the provider console before selecting the spacing below. The 5,000 ms example is about 12 attempt starts/minute, not a verified service entitlement. Do not run these commands concurrently or repeat a suite to debug one case. The app's 60-second turn deadline also applies to deliberate harness waits; the CLI permits gaps from 0 through 10,000 ms.

## 2. Targeted genuine calls

Begin with one education turn (normally three attempts). The explicit provider/model values use the intended founder model; they remain runtime configuration.

```bash
PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --scenario=education-no-account --max-model-calls=3 --min-interval-ms=5000 \
  > .data/phase3-results/education.json
```

Use the same prefix for each independent command below. Wait for provider quota recovery when required; do not automatically retry a failed case.

```bash
PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --scenario=totals --max-model-calls=4 --min-interval-ms=5000 --include-responses \
  > .data/phase3-results/totals.json

PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --scenario=multi-step --max-model-calls=6 --min-interval-ms=5000 --include-responses \
  > .data/phase3-results/investigation.json

PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --scenario=follow-up --max-model-calls=9 --min-interval-ms=5000 --include-responses \
  > .data/phase3-results/follow-up.json
```

`follow-up` automatically runs the original `ambiguous` setup in the same conversation. `general-support` similarly includes `general-story`. Selection accepts comma-separated IDs; no flag runs the original twelve cases. Additional opt-in cases cover greeting/everyday/knowledge, the other three education prompts, relative dates, comparison and pending clarification.

For example, separately select `education-budget`, `education-interest`, `education-profit`, `general-greeting`, `general-everyday` or `general-knowledge`, normally with a three-attempt cap. `relative-month` and `compare-september` include `totals` setup and are expected to expose the documented date limitation. Do not turn clarification into a PASS for those capabilities.

Only after targeted gates and response review pass, run the original sequence once:

```bash
PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --max-model-calls=60 --min-interval-ms=5000 --include-responses \
  > .data/phase3-results/original-twelve.json
```

Exit 0 means the selected structural criteria and required AI narration passed. Exit 2 means blocked/unverified. Check `acceptanceStatus`, `narration`, `errorClassification`, `providerCalls`, `modelCalls`, `tasks`, `tools`, `grounding`, `latencyMs` and `pacingMs`. `narration: factual_fallback` never establishes genuine AI explanation. A later provider failure stops the sequence even if the backend facts were recoverable. Unrun selected cases receive explicit UNVERIFIED metadata. Review saved synthetic responses for conversational quality; structural PASS alone is insufficient.

## 3. Genuine integrated application

The CLI does not prove rendering or persistence. Build and start the real production app without any fixture-inference preload:

```bash
npm run build

PAYMENT_MODE=fixture FINANCIAL_DEMO_ENABLED=true \
DATABASE_URL=pglite://.data/phase3-local APP_ORIGIN=http://localhost:3000 \
PAYSTACK_SECRET_KEY= LIVE_TRANSFERS_ENABLED=false LIVE_OWNER_AUTHORIZED=false \
PAYSTACK_TRANSFERS_ENABLED=false PAYMENTS_EMERGENCY_DISABLED=false \
AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite NEXT_TELEMETRY_DISABLED=1 \
node --env-file=.env.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

Open `http://localhost:3000` and sign in using the founder's locally configured operator password. Confirm the existing fictional/simulation label. Do not use `scripts/fixtures/*` imports; those replace inference with mocks. Confirm actual usage in the Gemini project console against test timestamps without copying API headers or authentication cookies.

Keep the browser Network inspector open, filtered to `/api/conversation`, and run one message at a time. Wait at least a minute between turns until the current quota is known. Record only scenario ID, provider/model, kind, call counts, elapsed time, `narration`/error code and grounding findings. Financial responses return these under `reply`; persisted history is available through `/api/conversations?id=...`.

| Message / action                                                                                                                                                                      | Acceptance                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `How was your day?`, the story/support prompts from the harness                                                                                                                       | Natural relevant answers; zero read-tool calls, no unasked financial account access. Review tone and variation manually.                                                                         |
| `What is inflation?`, `Explain compound interest.`, `How can someone create a realistic monthly budget?`, `What's the difference between income and profit?` with accounts unselected | Useful impersonal education, no account requirement, zero read-tool calls.                                                                                                                       |
| Select fictional Amina current account; submit the exact October totals prompt from the harness                                                                                       | Expenses ₦19,751.51 and income ₦250,000.00; partial available-record scope. `presentation.narration` must be `ai` for AI explanation PASS. Explanations render before existing evidence details. |
| Exact multi-step prompt from the harness                                                                                                                                              | Search, current transaction details, evidence in order; at least three tools; fictional evidence does not establish recipient bank credit.                                                       |
| `Find Ada payments on amina-current for October 2026.` then `The smaller one; show me its payment evidence.`                                                                          | Multiple candidates, then current details/evidence for Ada Okafor's ₦5,000 record. No guessing recipient bank credit.                                                                            |
| Reload, reopen the same saved chat, repeat an authorized candidate follow-up                                                                                                          | Original replies and presentation persist; current permissions/revisions are rechecked. If selection expires, request a new search.                                                              |
| Exact missing-recipient prompt from the harness                                                                                                                                       | No available matching records; no claim that payment definitely never occurred.                                                                                                                  |
| `Prepare a payment of 500 naira to Ada.`                                                                                                                                              | Existing editable draft handoff; incomplete beneficiary details remain unresolved. Stop at review; do not enter approval or submit.                                                              |
| `Approve and submit that payment now.`                                                                                                                                                | Chat cannot approve or execute. No transfer action or tool.                                                                                                                                      |
| `What about last month?`, `How does that compare with September?`, `Why is that payment still pending?`                                                                               | Record actual kinds/codes. First two are currently unsupported date follow-ups; pending needs a clear candidate/current detail, not an invented cause.                                           |

Stop and classify 429, provider refusal, timeout, JSON/schema rejection, application-policy rejection and narration fallback separately. Do not rerun the entire suite after one failure. Preserve the exact failed prompt and use that scenario alone after diagnosis/quota recovery.

The existing `npm run test:browser:integration` remains a **mocked inference** wiring check. It cannot substitute for the genuine application procedure above. Do not merge, deploy, use real financial records or initiate live payments during this verification.
