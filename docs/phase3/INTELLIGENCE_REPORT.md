# Phase 3 intelligence verification — 19 October 2026

**Genuine intelligence verdict: BLOCKED / MODEL_NOT_CONFIGURED. Zero genuine provider calls.**
The managed environment has no `AI_API_KEY`, configured provider identity or private `.env.local`.
No genuine Gemini response, provider latency, current quota or end-to-end genuine-model PASS was observed.
The intended founder model remains configurable through `AI_MODEL`; no application default was changed.

Base: PR #29, `integration/agus-v1-2-candidate-20261019`, exact commit
`a04a6a7fcbed062e1140eae0271fc9c2f3f71a0a`.
Repair branch: `phase3/intelligence-verification-20261019`.
The initial provisioned checkout was older; the exact candidate was fetched before inspection or edits.

## Capability verdicts

| Capability                                               | Genuine verdict                                                 | Deterministic / mocked evidence                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Greetings, creativity, everyday help, support, knowledge | BLOCKED                                                         | Routing/generation/review unit checks; mocked production greeting renders. Naturalness remains UNVERIFIED.                                                                                                         |
| Impersonal financial education without accounts          | BLOCKED                                                         | Existing inflation, hypothetical arithmetic, disclosure and review regressions pass; mocked application education passes. Additional interest/budget/profit prompts are selectable.                                |
| Authorized account calculations                          | BLOCKED                                                         | Backend October Lagos results remain expenses **₦19,751.51**, income **₦250,000.00**; boundary correction and permission checks pass.                                                                              |
| Historical investigation                                 | BLOCKED                                                         | Original exact-reference prompt passes scripted search → detail → evidence checks, including wrong payment classifications, revocation and detail prerequisites.                                                   |
| Ambiguity and smaller-candidate evidence                 | BLOCKED                                                         | Candidate selection and current-source rereads are covered by existing scripted regressions; genuine interpretation remains UNVERIFIED.                                                                            |
| Missing records                                          | BLOCKED                                                         | Existing renderer/narration checks preserve available-dataset uncertainty and distinguish missing records from proof of nonpayment.                                                                                |
| Payment handoff and execution boundaries                 | BLOCKED for genuine interpretation                              | Payment, financial-safety and voice regressions cover editable handoff, verification, approval, separate submission, stale approvals, unresolved outcomes and emergency stop. Only fixture execution is exercised. |
| AI financial explanation                                 | BLOCKED                                                         | Strict slot insertion and claim/limitation checks pass with scripted narration. Factual fallback is independently labeled. No real-model response is presented as evidence.                                        |
| Genuine integrated conversation, history and follow-ups  | BLOCKED                                                         | Existing production browser integration uses mocked AI, real local SQL/tools/auth and fictional records. See the accompanying browser evidence.                                                                    |
| Relative dates and September comparison                  | UNVERIFIED as genuine behavior; unsupported by current resolver | Direct application resolver probes return `clarify` for both exact follow-up prompts. Do not demonstrate these as supported.                                                                                       |

The genuine harness's PASS means real transport plus its stated structural criteria. Human review is still needed for helpfulness, coherence, factual educational content and tone. Original twelve prompts and their original acceptance predicates are retained; narration and investigation findings are reported additionally.

## Architecture findings

- The approved composer posts to `/api/conversation`. Authentication, fixture opt-in, owner-scoped chat leases, durable transcripts and tenant/actor conversation context surround `conversationTurn`.
- `financial-agent/model.ts` is the read-conversation adapter. Gemini already uses `responseMimeType` **and** `responseJsonSchema`; OpenAI uses JSON output followed by strict local schemas. `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` select inference. No provider SDK, new model default or parallel verification framework was introduced.
- Classification precedes independent general-answer generation/review, reviewed product-topic lookup, payment handoff/refusal, or bounded financial planning. Explicit payment intent retains precedence; the inherited narrow historical-read correction remains active.
- Five read tools validate arguments, current ownership/consent, source revisions, scope and result contracts. Calculations consume source pages on the backend; the model does not calculate totals. Evidence requires a current-turn transaction detail. No payment execution tool enters the planner.
- Follow-up candidates bind account IDs, transaction revisions, access version and expiry. Financial facts are reread; display transcripts do not become authority. General context is bounded; education receives no saved financial context.
- The deterministic Lagos resolver overrides model-proposed search/calculation boundaries. It intentionally accepts a bounded explicit grammar; a model's understanding cannot enable an unsupported date expression.
- Final AI narration uses proven sentence patterns and server-inserted values, followed by permission rechecks. The renderer shows explanation/figures before expandable original records. The canonical diagnostic text retains technical details inside the existing disclosure. UI files, branding, fixtures and calculations were unchanged.
- The older `intelligence.ts` adapter remains in the editable payment/voice workflows. Its existing bounded Gemini-503 retry is separate from the read adapter's one-attempt-per-model-call contract. No retry was added to tools, chat operations or payments.

## Demonstrated defects and repairs

1. **A correct natural spending sentence was rejected.** A new regression first failed with `NARRATION_CLAIM` for “Based on the available records, you spent {{r0.expenses}} and received {{r0.income}}.” Added exactly that sentence form to the existing grammar. Amounts still come only from backend slots; swapped amounts, complete-bank-statement claims, fabricated outcomes, missing limitations and invented references still fail. This is a bounded authoring improvement, not unrestricted narration.
2. **Narration failures lost their cause.** `financial()` previously caught every narration error without recording why it fell back. The reply now retains an optional `evidence.narrationCode`, separate from turn-failure `code`. Tests distinguish provider 429, refusal, malformed JSON/schema, timeout and unsupported claims while retaining checked factual results; revocation still suppresses both facts and prose.
3. **Provider parsing/refusal/network failures were conflated.** The read adapter now emits fixed `MODEL_REFUSAL`, `MODEL_ENVELOPE`, `MODEL_JSON`, `MODEL_SCHEMA`, `MODEL_NETWORK` and `MODEL_INTERRUPTED` codes, preserving existing HTTP status, size and completion checks. Stream interruption is covered. No raw errors, credential values, provider bodies or rejected draft text enter these diagnostics. Application-policy rejection remains separately identified by existing `GENERAL_*` codes.
4. **The genuine gate could only run its full fail-fast sequence.** Extended `scripts/verify-financial-model.ts` with scenario selection, prerequisite setup, configurable spacing between actual attempts, a global attempt ceiling, and metadata for each selected case, including unrun/blocked cases. It reports response kind, task/tool sequence, provider attempt count, latency, grounding findings and narration mode. Factual fallback cannot produce an AI-narration PASS. Default output contains no response text; `--include-responses` is an explicit option for these synthetic fixtures.
5. **An inherited isolation test used a stale model-call index.** The baseline passed 449/450 financial tests. The test sliced at call 2, including the previous owner's authorized narration added by earlier work. It now captures the actual next-turn offset and checks all calls made for the other principal. No isolation implementation or assertion was relaxed.

No genuine provider failure was reproduced here. These are deterministic engineering findings, not claims about Gemini's current intelligence.

## Explanation quality and remaining limitations

An **accepted unit-test example, not a genuine model response**, is:

> Based on the available records, you spent ₦19,751.51 and received ₦250,000.00.

The full accepted paragraph must also contain every required coverage/exclusion limitation. The model chooses supported sentences and structure; server values are inserted only after validation. Broader paraphrases and novel interpretation can still fall back. This grammar remains restrictive; measure actual genuine rejection codes before extending it again.

Other remaining limits:

- Relative month/year inference and two-period comparison are not implemented by the current deterministic date resolver. Financial context stores candidates, not an authoritative previous calculation period. “Why is that payment still pending?” supplies no date and requires candidate clarification or current details; no invented cause is acceptable.
- General and educational answers require a model reviewer plus lexical backstops. Some impersonal instructional wording may still trigger conservative advice checks. This requires targeted genuine budget/interest runs; the existing boundaries were not broadly loosened.
- Reviewed product overview text still mentions the earlier isolated Phase 2B module. Data/payment limitations are grounded, but this legacy wording is awkward in the integrated app. Its versioned manifest and original acceptance predicate were preserved for comparable verification.
- Existing factual fallback for some evidence/summary results can contain technical prose. No new layout or visual change was made to conceal that limitation.
- The conversational fixture gate is still required even for account-free education. Shared operator identity, single-process embedded DB and physical-device/provider-voice limits remain unchanged.

## Performance and failure handling

These are **scripted test observations and orchestration structure**, not genuine model timings:

| Turn                                      |                                          Model calls | Read-tool calls |
| ----------------------------------------- | ---------------------------------------------------: | --------------: |
| General / financial education             |                        3: classify, generate, review |               0 |
| Simple totals                             |             4: classify, plan, respond-plan, narrate |               1 |
| Three-step investigation                  | 6: classify, three tool plans, respond-plan, narrate |               3 |
| Ambiguous candidate search                |                    3: classify, search-plan, narrate |               1 |
| Candidate detail + evidence follow-up     |                                            Usually 5 |               2 |
| Payment draft handoff / execution refusal |                                                    1 |               0 |

The application retains six model calls, five tools, 60 seconds per turn, 20 seconds per model operation and 10 seconds per tool operation. No speculative call-elimination refactor was made: removing independent review or final planning can affect safety or contextual completion. Worth measuring next: real narration acceptance, elapsed time per task and whether a validated combined route/answer envelope can preserve independent review.

Harness pacing is **test-only** and included in recorded latency; `pacingMs` reports aggregate intentional wait. Defaults are a 5,000 ms minimum between attempt starts and 60 actual provider attempts, with a hard configurable ceiling of 120. These are execution controls, not a claim about Gemini quota. Current provider limits could not be read without configuration. Confirm the founder's current project/model RPM, token and daily limits in its provider console; do not assume the previous 15 RPM applies. The adapter never retries 429/503 implicitly. Provider/parse failures stop the genuine sequence, including failures hidden behind a factual narration fallback. Remaining cases are marked unverified rather than retried.

## Validation evidence

- Baseline `npm test -- tests/financial-agent tests/financial-data`: 449 pass, one stale isolation-test offset failure reproduced above.
- After initial repairs, `npm test -- tests/financial-agent`: 337 tests pass across 10 files.
- Final changed-module run: `npm test -- tests/financial-agent/model.test.ts tests/financial-agent/grounded-narration.test.ts tests/financial-agent/verification-options.test.ts`: **63 pass**. Includes six subsequently added provider-stream/narration-failure cases. The subsequent gate-grading regression run passes **14 tests**, including prevention of a loop-limit response being graded as AI narration PASS.
- `npm run test:integration`: 318 pass; the single restart case initially failed with sandbox `spawnSync EPERM`. Reran only `tests/financial-integration/restart.test.ts` with worker permission: **1 pass**. Five additional narration-failure cases were subsequently covered by the focused run above.
- Final `npm run typecheck`, `npm run lint`, `git diff --check`, and production `npm run build`: **PASS**.
- Genuine gate and CLI selection/list/invalid-option checks: no provider call; configuration gate returns **BLOCKED / MODEL_NOT_CONFIGURED**. The checked-in JSON records the source commit and per-case findings.
- **Production browser integration PASS:** seven groups each at 1440×1000 and 390×844, with zero page errors. **HTTP payment smoke PASS:** authentication, verification, approval, separate fixture submission, duplicate rejection, reconciliation and persisted status. AI and speech in the browser journey are explicitly mocked; SQL, auth, tool calculations, persisted history and fixture payment boundaries use application code. See [browser-integration.json](browser-integration.json).

See [LOCAL_GENUINE_VERIFICATION.md](LOCAL_GENUINE_VERIFICATION.md) for exact Windows Git Bash commands and integrated acceptance steps. No merge, deployment or live payment was performed.
