# Gemini HTTP 503 investigation

## Scope and evidence

Diagnostic branch `diagnostic/gemini-503` starts at PR #3's exact fetched and GitHub-confirmed head, `b8e84e9b66cccc4e52f96536a518f070428cbf80` (`feat/chat-first-financial-agent`). The original worktree is untouched. This PR targets that feature branch for a focused diff; it does not merge or modify PR #3.

The user reports repeated application HTTP 503 responses and a successful simple PowerShell `generateContent` request using the same machine, key and configured model. That is user-provided evidence, not a test performed here. No Gemini credentials, failing request capture or actual provider response body were available. **The underlying provider failure has neither been reproduced nor fixed by this work. Root cause remains unconfirmed.**

## Confirmed request and error handling

`src/lib/intelligence.ts:modelPlan` constructs the following Gemini request (unchanged by this diagnostic change):

- POST `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL || "gemini-2.5-flash")}:generateContent`.
- Headers: `x-goog-api-key` from server `AI_API_KEY`, `Content-Type: application/json`. The key is not placed in the URL.
- Body: `{"contents":[{"role":"user","parts":[{"text":"<prompt>"}]}],"generationConfig":{"responseMimeType":"application/json"}}`.
- Optional image adds `{inlineData:{mimeType,data}}` to the same `parts` array. Image extraction accepts validated PNG/JPEG/WebP up to 5 MiB before base64 encoding.
- The single prompt concatenates financial safety instructions, `z.toJSONSchema(planSchema)` as JSON text, serialized persisted context, and the current user request. There is no separate `systemInstruction`, API `responseSchema`/`responseJsonSchema`, function call, tool configuration, temperature or output-token override.
- Chat validates user text to 4,000 characters; context contains the last 16 actor-visible messages (including saved proposal/source data) and summaries of up to 10 actor-owned batches. There is no aggregate prompt-byte/token limit. Count bounds do not establish the size of a particular failing request.
- A credential-free mocked transport capture using this locked dependency tree measured **2,633 UTF-8 request bytes / 2,297 prompt characters** for `modelPlan("Hello", {})`, without an image. These are synthetic fixture measurements, not production measurements or token counts.
- Successful text is JSON-decoded and validated against the strict Zod plan schema. Gemini candidates/parts are validated before plan parsing. Neither invalid model output nor provider errors trigger demo fallback.
- Before this change, every non-2xx Gemini response immediately became `AppError("AI provider unavailable (<status>)", 502)`; the route returns HTTP 502 with that generic message. Thus the displayed `(503)` identifies an upstream HTTP status, not the application's own response status. The provider's body, code and message were discarded.
- Actual runtime `AI_MODEL` and actual failing bytes cannot be established here. The default is code evidence only; the chosen model has not been changed.

## Diagnostics and bounded inference retry

`src/lib/ai-inference.ts` now logs a server-only `AI provider HTTP error` record for each failed Gemini/OpenAI HTTP attempt. Fields include provider, model identifier (restricted syntax, otherwise `custom-model`), HTTP status, numeric provider code in the HTTP range, allowlisted Google RPC status, safe message, request UTF-8 bytes, JSON response MIME mode, attempt, retry decision and backoff milliseconds.

Privacy is fail-closed: only three exact generic service messages are retained verbatim; every other parsed message becomes `Provider message withheld`. Numeric provider codes and known RPC statuses are allowlisted. Error response reads are capped at 8 KiB; malformed, non-JSON, oversized and unreadable bodies yield HTTP-only diagnostics. Nested error details, headers, URLs, raw error bodies, full prompts, context, images, keys, recipient names, accounts and amounts are never logged. Arbitrary model identifiers are withheld. Unrecognized messages are deliberately less informative than raw provider text; do not replace this with raw body/error logging. No provider details are sent to the browser.

One additional attempt is allowed for Gemini HTTP 503 when the sanitized RPC status is absent or `UNAVAILABLE`. This is a conservative HTTP service-unavailable mitigation, **not evidence that this incident is transient or that retry resolves it**. Other statuses, quota/permanent RPC statuses, network exceptions, timeouts and invalid successful responses are not retried. OpenAI gets diagnostics only. Backoff is 500–1,000 ms with jitter; a numeric `Retry-After` up to 2 seconds is respected. Longer, negative or unsupported values (including HTTP dates) suppress retry, avoiding an early retry. The original 45-second timeout is one shared deadline across requests, backoff and response consumption.

Only the identical model HTTP inference request repeats. Chat orchestration, draft creation, verification, approval, execution, OTP and reconciliation are outside the loop. Successful inference is validated and consumed once. Payment and approval modules and UX are unchanged. Exhaustion preserves the original generic provider failure and no-fake-response behavior. A retry may incur a second inference charge; there are at most two calls per inference.

## What can and cannot be concluded

| Candidate cause             | Current evidence                                                                                                                                         | Evidence still needed                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model availability          | Runtime override supported; default `gemini-2.5-flash`. User reports same configured model succeeded directly. No proof of general model unavailability. | Compare the safe logged model with the direct test's model; inspect failed provider status.                                                                                    |
| Request structure           | Exact single-message JSON wire contract confirmed by mocked transport tests. No API-level schema is supplied. No observed 400/`INVALID_ARGUMENT`.        | Controlled same-model requests differing only in JSON MIME configuration and schema instructions. Mock acceptance does not prove Gemini acceptance.                            |
| JSON response configuration | `responseMimeType: application/json` is sent; schema is in prompt text only.                                                                             | Compare simple prompt with and without this config, then the structured instructions, using synthetic data. No silent fallback to text mode is introduced.                     |
| Request size/context        | Application prompt includes schema/context; 2,633-byte synthetic minimal fixture; actual failing size unknown.                                           | Safe `requestBytes` from the failing application call, then controlled synthetic context sizes. Bytes are not tokens; a larger prompt alone does not establish a size failure. |
| Quota                       | HTTP 503 alone does not establish quota exhaustion; no actual 429/`RESOURCE_EXHAUSTED` body supplied.                                                    | Sanitized provider code/status and private provider-side quota metrics. Quota errors are not retried.                                                                          |
| Transient capacity          | HTTP 503 can represent temporary unavailability. This is compatible with, but does not prove, capacity pressure.                                         | Actual `UNAVAILABLE`/recognized overload message and whether a later identical attempt succeeds. Persistent 503 still requires investigation.                                  |

## Follow-up without credential disclosure

Run the application normally in the existing private configured environment and inspect only `AI provider HTTP error` records. Keep raw prompts, responses and payment data private. If a 503 continues, use synthetic content in a private same-model comparison: (1) simple prompt; (2) same prompt with JSON MIME mode; (3) schema/safety instructions with empty context; (4) synthetic larger context. Hold the key, endpoint, model and timing conditions as constant as practical; record only HTTP/RPC status, safe message category, bytes and retry outcome. This separates variables; intermittent results still do not prove causality. Do not change the selected model without supporting evidence.

## Regression validation

Mocked tests cover Gemini endpoint/model/header/body contract and image encoding; default and configured models; 503 recovery with identical requests/shared signal/bounded backoff; exhaustion without saved messages or payment changes; a single unverified draft after recovery; no approval/execution; non-retried 4xx/quota/other HTTP errors; RPC quota under HTTP 503; Retry-After handling; deadline cancellation; network/invalid-success failures; OpenAI diagnostics without retries; and sanitization of secrets, payment details, nested fields, malformed and oversized bodies.

Results on this diagnostic branch:

- `npm test`: **107 tests passed** across six files (82 existing tests plus 25 inference regressions).
- `npm run typecheck`, `npm run lint`: passed.
- `npm run build`: passed (Next.js production build).
- `npm run test:http`: passed the existing production fixture journey: login/route protection, verification, password approval, explicit submission, duplicate rejection, reconciliation, persisted status chat and CSV. No real money/provider calls.
- Prettier check for changed TypeScript files and `git diff --check`: passed.

The initial restricted-sandbox test run had five existing restart/persistence failures because `spawnSync` was denied (`EPERM`); the complete suite passed when run with permitted network/process access. No test or payment implementation was relaxed to achieve the passing result.

All provider transport responses in these tests are mocked; there is no live Gemini verification.
