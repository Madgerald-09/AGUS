# Financial education rejection repair

18 October 2026, WAT. Based exactly on PR #22 at
`5f00ab680b921dbac3093a5f69c4e56b663a23bd`; target branch
`fix/historical-payment-intent-routing`. Keep draft; do not merge or deploy.

## Cause and limits of the available evidence

The reported genuine Gemini 3.5 Flash-Lite failure was
`education-no-account` / `GENERAL_REJECTED`. The rejected answer and selected
route were not captured. This establishes that classification, draft generation
and review returned valid schemas, then at least one combined safety gate failed.
It does not establish which gate failed or what the answer said.

Independent inspection found these possible paths to that code:

- The model reviewer returned `safeGeneralConversation: false`. Its instructions
  permitted impersonal education but did not explicitly distinguish generic
  teaching pronouns and hypothetical monetary examples from personal claims.
- On `financial_education`, `personalFinancialLanguage()` rejected every personal
  pronoun, including harmless `your`, `we` and `I`, and every currency symbol.
  Thus even an approving semantic review could not release ordinary education.
- On `general`, `financialLanguage()` rejected financial prose. A mistaken
  general classification can still produce this safe failure; the unavailable
  trace does not prove the failing run selected the education route.
- `actionClaim()` rejected first-person claims of approval, submission, execution,
  sending, payment or verification. This remains intentional.
- `scrub(answer) !== answer` rejected URLs, credentials, long numbers and control
  characters, but also ordinary newlines and tabs in explanatory prose.

Other failures (schema, provider, timeout, context storage, budgets) already have
different codes and cannot explain the reported `GENERAL_REJECTED` alone.
Personal/mixed requests still enter financial reads, and explicit payment intent
still takes precedence before education. No routing exception was introduced.

## Repair and diagnostic codes

Replace the blanket education pronoun/currency ban with contextual lexical
backstops for owned financial assertions, personal holdings/activity, payment
claims and concrete payment instructions. Generic teaching pronouns, hypothetical
amounts and conditional examples can pass. An example label does not exempt a
personal assertion or payment instruction. Existing recommendation, guarantee,
status, product and credential restrictions remain conservative.

The generator and independent reviewer now explicitly distinguish these safe
forms from personalized claims. Fabricated financial facts, sources and unsupported
current rates/statistics are explicitly prohibited. Review still receives both
the question and answer; a negative or malformed review never falls back to
approval. Education still receives empty history and no account data or tools.

Ignore only CR, LF and tab when comparing against the disclosure scrubber. Output
can retain normal formatting; persisted education still uses the existing scrubber.
URLs, keys, long numbers and every other previously rejected control character
remain blocked.

Fixed diagnostic strings use the existing `evidence.code` field, which the genuine
verifier already records. No logger or content-bearing diagnostic was added.

| Code                        | Meaning                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `GENERAL_MODEL_REJECTED`    | Independent semantic reviewer returned false.                 |
| `GENERAL_POLICY_EDUCATION`  | Education lexical backstop rejected the draft.                |
| `GENERAL_POLICY_FINANCIAL`  | General-conversation financial backstop rejected the draft.   |
| `GENERAL_POLICY_ACTION`     | Action-claim backstop rejected the draft.                     |
| `GENERAL_POLICY_DISCLOSURE` | Disclosure/control-character scrubber would change the draft. |

Codes report the first failing gate in the order above; they do not establish that
later gates would pass. The public unavailable text remains unchanged. No question,
answer, financial record, credential or provider response is added to diagnostics.

Lexical patterns remain conservative English safeguards, not a natural-language
parser or factuality proof. Semantic review remains necessary for paraphrases,
numeric-free personal claims and invented real-world facts outside those patterns.
Scripted rejection tests prove enforcement of review decisions, not the genuine
model's ability to recognize every unsafe answer. Genuine intermittency is not
claimed resolved without a later authorized provider run.

## Regression evidence

- Before implementation, 14 new safe-output cases: **10 failed / 4 passed**.
  Failures reproduced generic pronouns, currency examples and prose formatting.
- Final focused run: **296 passed / 7 files**, exit 0, 18.28 seconds:

  ```sh
  npm test -- tests/financial-agent/education.test.ts tests/financial-agent/model.test.ts tests/financial-agent/security.test.ts tests/financial-agent/routing.test.ts tests/financial-agent/orchestration.test.ts tests/financial-integration/conversation.test.ts tests/payments.test.ts
  ```

- `npm run lint` and `npm run typecheck`: exit 0.
- Scoped Prettier and `git diff --check`: pass.
- The 76 new scripted cases cover ordinary explanations, pronouns, currency and
  conditional examples, formatting, mixed/personal requests, personalized account
  claims, payment claims/instructions, credentials, adversarial requests, fabricated
  facts rejected by semantic review, malformed reviews and fixed diagnostic codes.
  Both provider adapters carry the isolated education and strict review schemas
  through mocked HTTP. No genuine HTTP/model inference is implied by these tests.
- Existing focused tests retain financial grounding, permission/consent checks,
  historical payment routing, authenticated payment review, OTP and execution
  safeguards. No payment implementation changed.

No full-suite run or genuine API call was made. The genuine verification script,
all 12 scenario definitions and every acceptance predicate are unchanged.

## Precise next steps

1. Review this draft against PR #22's branch. Do not merge or deploy as part of
   this repair.
2. In a separately authorized runtime, check out this repair PR's exact clean
   head and install locked dependencies. Privately retain the original genuine
   Gemini 3.5 Flash-Lite provider/model configuration and authorized API access;
   do not substitute a default model, use transport mocks or print the key.
3. Run the existing verifier once, with fixture payments, normal proxy/CA trust
   and the exact model identifier in the private runtime or `.env.local`:

   ```sh
   AI_PROVIDER=gemini PAYMENT_MODE=fixture NODE_USE_ENV_PROXY=1 node --env-file-if-exists=.env.local --import tsx scripts/verify-financial-model.ts > /tmp/agus-education-gemini-verification.json
   verification_status=$?
   printf 'Verification exit status: %s\n' "$verification_status"
   ```

4. Retain only the sanitized JSON and exit status. Require exit 0, top-level
   `PASS / ALL_SYNTHETIC_SCENARIOS_VERIFIED` and **all 12 cases PASS**: general
   story, general support, education without accounts, personal request without
   accounts, product, totals, multi-step investigation, ambiguous search,
   follow-up, no results, draft handoff and execution refusal. Confirm the recorded
   exact commit, clean-tree status and original provider/model. Any failed case
   stays BLOCKED / exit 2; use its fixed reason code without logging full content
   or relaxing assertions. Stop after recording the result.
