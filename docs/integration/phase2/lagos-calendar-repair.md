# Lagos calendar tool interval repair

18 October 2026, Africa/Lagos. Based exactly on PR #20 at
`95ef511fcebdb688ead3fafaa6ca38d539b3e264`; repair targets
`fix/agus-product-integration-grounding`. Keep draft; do not merge or deploy.

## Root cause

The reported genuine Gemini 3.5 Flash-Lite run passed the first five scenarios,
then failed `totals`. Its model-proposed `calculate_spending` arguments used
`2026-10-01T00:00:00Z` to `2026-11-01T00:00:00Z` for the full Lagos calendar
month of October 2026. The orchestration layer accepted these schema-valid UTC
instants without checking them against the user's calendar period. The existing
`lagosDateInterval()` helper already converts local calendar boundaries correctly,
but orchestration did not use it.

The wrong interval excludes the posted ₦1.00 `october-midnight` debit at
`2026-09-30T23:00:00Z` and includes the posted ₦888.88 `november-midnight` debit
at `2026-10-31T23:00:00Z`. Its ₦20,639.39 expense total exceeds the correct
₦19,751.51 by ₦887.88. The financial-data calculation itself is correct for
the interval it receives.

## Change

`financial-agent/date-window.ts` resolves a bounded set of current-user date
expressions without model interpretation: named month plus year (including common
three-letter month names), ISO calendar dates introduced by `on`, and ISO date
ranges with an explicitly exclusive end. These use the unchanged Lagos helper.
Zoned ISO timestamp windows introduced by `from ... to/until ...` retain their
actual instants, including UTC and numeric offsets; they are not converted into
Lagos calendar days. The end is exclusive, as in the existing financial contracts.

Calendar validity, ordering, precision and the existing 366-day limit are checked
before execution. Missing years, numeric date ambiguity, invalid dates, conflicting
periods, unsupported relative dates, partial-period qualifiers and unclear range
end semantics return the existing date clarification with zero financial tools.
Unsupported forms should be restated using an explicit month/year or supported
date/timestamp range. The resolver deliberately does not implement a general
natural-language date parser or infer dates from stored conversation prose.

The agent passes the resolved window to planning, replaces only the interval
fields on `search_transactions` and `calculate_spending`, and revalidates the call
before the existing execution and authorization checks. An interval read with no
resolved user window clarifies instead of trusting model-invented endpoints.
Resolution precedes privacy scrubbing because date-only ISO strings can otherwise
be redacted as long numbers; only validated endpoints enter the planning context.
The call used for dispatch, rendering, repeat detection and persisted search
filters is the same corrected call.

No model prompt changes, financial-data implementation changes, fixture or
expected-total changes, payment safeguard changes, or verifier assertion changes.
Two existing test request strings now explicitly include the year instead of
depending on an unstated year. Test transport remains labelled scripted transport.

## Validation

```sh
npx --no-install vitest run tests/financial-agent tests/financial-data tests/financial-integration/conversation.test.ts
npm run lint
npm run typecheck
```

Final results on Node 24.19.0: **283 tests passed / 13 files**, exit 0
(13.64 seconds); lint and typecheck both exit 0. Scoped Prettier and
`git diff --check` also pass.

Regression coverage reproduces the wrong model interval and ₦20,639.39 total using
the real fixture dispatcher, then verifies the corrected endpoints, ₦19,751.51
expenses, ₦250,000.00 income and ₦230,248.49 net. Searches independently verify
inclusion of the October boundary and exclusion of the November boundary. Other
cases cover leap days/year rollover, explicit UTC/offset timestamp preservation,
unchanged non-date filters, malformed dates/timestamps, clarification with zero
tools, missing user dates, and ordinal follow-ups without invented dates.

Genuine inference was not attempted here: the managed runtime reports no model
secret bindings. Scripted regression tests do not establish genuine model quality.

## Genuine Gemini rerun

In the already authorized model runtime, use its existing private key configuration
and supported egress to `generativelanguage.googleapis.com`, preserving normal
proxy and CA trust. Use the exact configured model ID from the failing genuine
Gemini 3.5 Flash-Lite run. With `AI_MODEL` already set to that ID:

```sh
git fetch origin fix/lagos-calendar-tool-intervals
git switch fix/lagos-calendar-tool-intervals
git pull --ff-only origin fix/lagos-calendar-tool-intervals
npm ci
git rev-parse HEAD
git status --porcelain
AI_PROVIDER=gemini AI_MODEL="${AI_MODEL:?Set the original Gemini 3.5 Flash-Lite model ID}" PAYMENT_MODE=fixture NODE_USE_ENV_PROXY=1 node --env-file-if-exists=.env.local --import tsx scripts/verify-financial-model.ts > /tmp/agus-lagos-gemini-verification.json
verification_status=$?
printf 'Verifier exit status: %s\n' "$verification_status"
cat /tmp/agus-lagos-gemini-verification.json
```

Use a clean repair head and Node 24.19.0 or a compatible runtime with environment
proxy support. Keep the private key in the existing runtime/private environment
file; do not print it. Do not load fixture transport preloads or HTTP mocks. Retain
the sanitized JSON and exit status with commit, clean-tree status, actual
provider/model, case outcomes and call counts.

The unchanged gate requires exit **0**, top-level **PASS /
ALL_SYNTHETIC_SCENARIOS_VERIFIED**, and **all 12 cases PASS**, including every case
after `totals`. A failed case remains **BLOCKED**, exit **2**. This verifies only
the synthetic financial scenarios; it does not verify live bank integrations or
payment execution. No merge or deployment is part of this repair.
