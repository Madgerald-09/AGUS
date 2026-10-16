# Gemini and Paystack integration repair

## Gemini response contract

The previous adapter put the Zod JSON schema only in the prompt and requested JSON MIME mode. That guarantees neither the application's required fields nor its strict financial types. It also required text on every response part, concatenated thought text into the answer, and did not check completion status. Successful HTTP responses with blocked, truncated, malformed or schema-invalid output escaped as generic errors (or misleading request-validation errors for ordinary JSON clients).

Gemini requests now supply `generationConfig.responseJsonSchema` from the existing strict plan schema alongside `responseMimeType`. The configured `AI_MODEL` is preserved, including `gemini-3.5-flash-lite`; no model substitution or simulated fallback is introduced. The response decoder reads the first candidate's final text parts, excludes thought text and metadata-only parts, and rejects reported non-STOP completion reasons. Missing/blocked candidates, empty answers, malformed JSON and invalid plans fail closed before downstream mutation. OpenAI responses use the same safe JSON/schema failure boundary.

Diagnostics identify `envelope`, `completion`, `text`, `json` or `schema`, the sanitized model identifier, and bounded Zod issue codes/counts. They never include provider bodies, issue messages/values, prompts, account details, thought text, signatures or credentials. Successful-response validation failures become safe upstream 502 errors rather than client parameter errors. Existing inference-only HTTP retry behavior remains unchanged; decoding failures are not retried.

NDJSON HTTP 200 establishes a stream before inference finishes. Only a final `result` event establishes application success. Failure terminates with `{ ok: false, status: 502, error: "..." }` (or the applicable application status), without a result event. The existing browser checks error events and preserves input. Ordinary JSON requests return HTTP 502 for invalid model output.

Financial Zod constraints, server-composed narration, extraction grounding, image manual review, ownership, beneficiary verification, review digest, password approval and separate explicit submission remain in force. No payment execution code or live-transfer configuration changed.

References: [Gemini 3.5 Flash-Lite capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [generateContent response parts and completion reasons](https://ai.google.dev/api/generate-content), [structured JSON output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Paystack bank pagination

The bank-specific contract documents `use_cursor` and `next`, rather than an offset `page`. Incrementing the unsupported parameter can repeatedly retrieve the same full list until the old 20-page limit fails.

Requests now explicitly enable cursors, retain Nigeria/NGN filters and a page size of 100, and pass the response's `meta.next` using URL encoding. Cursor metadata controls termination, including short pages with a continuation and full terminal pages. Absent, null, empty and literal `"null"` terminal cursors stop pagination. Bank codes are deduplicated; repeated/cyclic cursors, continued pages without new bank codes, malformed pagination and more than 20 pages fail closed. Each request retains the existing 20-second timeout. A missing metadata object is treated as an unpaginated list.

References: [Paystack List Banks](https://paystack.com/docs/api/miscellaneous/#list-banks), [cursor pagination metadata and termination](https://paystack.com/docs/api/pagination/).

## Verification and remaining credentialed checks

- `npm test`: 184 tests pass across 10 suites, including provider contract regressions, authenticated API errors/banks, financial grounding, approval safeguards and restart persistence.
- `npm run typecheck`, `npm run lint`, `npm run build`: pass.
- `npm run test:http`: pass against the production build with isolated fixtures, including verification, approval, explicit submission, duplicate rejection and reconciliation.

Provider responses in regression tests are controlled mocks. No genuine provider credentials are configured in this environment, so the exact production incident response has not been captured and a genuine successful call is not claimed. With live flags still false, validate the following in the intended environment:

1. Use a server-side Gemini credential and `AI_MODEL=gemini-3.5-flash-lite`, with `PAYMENT_MODE=fixture`. Check greetings, missing-account instructions, follow-up edits, grounded spending/status questions and image extraction with manual review. Confirm model access, schema acceptance, quota/latency and a completed result event. If it fails, use the safe diagnostic stage without recording raw financial/provider payloads.
2. Use a matching Paystack test secret with `PAYMENT_MODE=test`. Call authenticated `GET /api/banks`; confirm terminal cursor behavior and unique bank codes against the account's actual bank catalogue. Check test beneficiary resolution separately. Do not enable live transfers to validate this read-only listing fix.

No real transfer, live configuration change, deployment or merge was performed.
