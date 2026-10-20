# Focused narration repair after genuine Gemini verification

The founder reports these genuine local observations on PR #30 at `48701edf`, using `gemini-3.5-flash-lite`:

- Inflation education **PASS**: three genuine calls, no read tools or errors.
- October totals structural acceptance **PASS**, AI narration **UNVERIFIED**: four genuine calls and one calculation returned expenses ₦19,751.51, income ₦250,000.00 and difference ₦230,248.49. Narration fell back with `NARRATION_CLAIM`, without an HTTP error or calculation mismatch.

These are founder-reported results. No genuine inference was run in the development environment for this repair. The specific rejected draft was not retained, so its exact offending sentence cannot be reconstructed from `NARRATION_CLAIM` alone. The following defects were reproduced independently; they are not guesses presented as the founder's actual model output.

## Reproduced rejection paths

Seven initial regressions all failed before this repair and pass afterwards:

| Input structure                                                   | Previous rejection mechanism                                                                                                                 | Repair                                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Expenses  total {{r0.expenses}} ...`                             | Clause reconstruction retained repeated internal spaces while the comparison text collapsed them; `NARRATION_CLAIM` before grammar matching. | Normalize whitespace once before tokenization and matching.                                                                           |
| Newlines inside an otherwise valid sentence                       | Same normalization mismatch; later matching also required literal single spaces.                                                             | Same normalization, without changing paragraph boundaries.                                                                            |
| Standalone `{{r0.limit0}}.`                                       | The limit was emitted as one clause and the extra period as an unsupported clause.                                                           | Consume one redundant period attached directly to a standalone limit; insert the server's already-punctuated limitation exactly once. |
| `Your total spending was ... while your total income was ...`     | Truthful role-bound wording outside the small original regex vocabulary.                                                                     | A finite spending/income clause grammar; expense/income placeholders remain bound to their roles.                                     |
| `The net difference is {{r0.difference}}.`                        | Only `The difference is ...` or `... comes to ...` matched the unfiltered result label.                                                      | Bounded difference alternatives. Filtered results still require “filtered difference”.                                                |
| `spending came to ...; income amounted to ...`                    | Missing tense/verb and semicolon alternatives.                                                                                               | Explicit conjunction/semicolon combinations of proven propositions.                                                                   |
| `Income exceeded expenses by {{r0.difference}} in these records.` | This accurate positive-difference interpretation had no authoring pattern.                                                                   | Permit only when the backend difference is strictly positive; negative/zero cases reject it.                                          |

The parser consumes every non-whitespace character. Each entire clause still needs an anchored proof pattern. It may supply a missing final period only when the resulting complete declarative sentence matches a proof. It never strips arbitrary words, changes a claim, repairs monetary values or treats a model reviewer as financial authority.

## Contract and Gemini instructions

The generated contract now includes concrete `authoring.examples`, each paired with its actual result ID. Examples contain placeholders rather than literal values or provider labels. Tests pass every generated example through the real validator for all five read-result types, as well as testing negative/zero and filtered calculations.

Both configured providers receive the same improved narration instructions; Gemini's existing structured response schema is unchanged. Instructions now say to:

- Prefer these concrete, already-valid examples and choose their order/paragraph structure naturally.
- Keep placeholders and semantic roles intact; never copy currency values, dates, identifiers or labels from facts or `authoring.slots` into prose.
- Include **every** required limitation. The former hardcoded example included only `limit0`, although totals have more than one limitation.
- Treat income less expenses as a difference, never an account balance or savings. No invented outcomes, bank connections, recommendations or cross-period comparisons are authorized.

Raw monetary literals are rejected even when numerically correct. All accepted monetary values are inserted by the server after proof validation. Source validation, current permission/revision checks, factual fallback and the approved v1.2 renderer remain unchanged. No extra model call, automatic retry, classifier change or payment operation was added.

## Safe diagnostics

On rejection, `reply.evidence.narrationCode` remains available and a new `narrationDiagnostic` describes the first failure. The existing genuine harness automatically includes it through its evidence serialization, even when the displayed response is the factual fallback.

Example for an unsupported balance claim using the difference placeholder:

```json
{
  "version": 1,
  "stage": "claim",
  "category": "unsupported_structure",
  "paragraphIndex": 0,
  "clauseIndex": 0,
  "structure": ["text", "difference_slot", "period"]
}
```

Categories distinguish unsupported grammar, literal values, unknown placeholders, embedded limits, missing limitations, malformed schema and result-reference failures. Indices are zero-based. `structure` contains at most 24 fixed token-role/punctuation labels. It never includes draft words, numbers, names, account/result IDs, unknown placeholder names, URLs, credentials, schema issue payloads or hashes. The rejected draft is not logged, displayed or persisted. `--include-responses` still shows the accepted response or factual fallback, not the rejected draft.

Security regressions reject swapped monetary slots, a difference relabeled as balance/savings/spendable funds, invented outcomes/comparisons, false complete-bank coverage, unapproved sources, missing limitations, wrong-result slots and extra claims after limitations. A mocked-HTTP Gemini totals journey exercises successful narration, factual fallback with safe diagnostics, and permission revocation suppressing both facts and narration. Its model-call count remains four.

## Verification and one local retest

Development verification uses deterministic fixtures and mocked provider HTTP only. **440 tests across 15 files pass**, including 51 new deterministic/mocked regressions. Lint, typecheck, diff checks and production build pass. See [narration-repair-validation.json](narration-repair-validation.json). Genuine repaired-model acceptance remains **UNVERIFIED** until the founder runs the following once after pulling the updated PR #30 branch.

From the repository root in Windows Git Bash, with the existing private `.env.local`:

```bash
PAYMENT_MODE=fixture AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite \
node --env-file=.env.local --import=tsx scripts/verify-financial-model.ts \
  --scenario=totals --max-model-calls=4 --min-interval-ms=5000 --include-responses
```

This selects only the original totals prompt, preserves its acceptance predicate, spaces attempts and caps genuine provider attempts at four. No education warm-up or full suite is needed. Success requires `status: PASS`, `acceptanceStatus: PASS`, `kind: financial`, `narration: ai`, one `calculate_spending` tool and the unchanged three figures. Review the `explanation` field for natural, accurate wording and the required scope/limitations.

If it still falls back, record `narrationCode` and `narrationDiagnostic` (plus task/tool counts), without sharing the rejected draft or credentials. `literal_value` identifies prose that copied values instead of slots; `embedded_limit` identifies limit placement; `unsupported_structure` plus the token roles identifies an unproved clause form. A valid paraphrase can then receive another bounded proof rule; a new financial assertion must remain rejected. No merge or deployment is part of this repair.
