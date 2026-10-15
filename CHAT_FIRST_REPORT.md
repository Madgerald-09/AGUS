# Chat-first Financial Agent handoff

Implemented on `feat/chat-first-financial-agent`, starting from fetched and verified `main` at `7a4f4edf63d4bb4c0493767e3bb7a402c9211609`. Temporary product label: **Financial Agent**.

## Experience delivered

The product-owner update is applied to this same implementation: the default canvas is pure `#000000`, primary text and controls are `#FFFFFF`, cards and inputs use subtle near-black surfaces, and all borders and secondary text are neutral grayscale. There are no colored accents or gradients. Payment statuses use distinct icons and explicit text (including “Processing · unresolved” and “Unknown · needs follow-up”), so meaning does not depend on color. The temporary **Financial Agent** name is retained.

- The conversation fills the primary workspace; the composer and image attachment control stay visible. Welcome suggestions cover supplier payments, uploads, pending transfers and spending.
- “Pay my bills” asks for recipient, amount, bank and account. Missing values remain blank in an inline proposal. Choosing a clearly labelled fictional recipient fills the listed identity details; it does not choose an amount.
- Proposal edits, including partly entered numeric fields, persist when leaving a field. Add/remove actions also persist. Partial input cannot pass the strict payment instruction schema.
- Explicit single-recipient follow-ups can complete a proposal across messages. Continued proposals retain the original request. Multiple-recipient ambiguity requires editing the relevant card.
- Saving a proposal atomically links one unverified batch to its conversational source. Concurrent saves cannot create duplicate batches from the same proposal. Older proposals that were continued cannot be saved again.
- The existing detailed payment card now appears within the conversation: bank, account, beneficiary, amount, reference, fee reserve, confirmed fees, errors, approval record and provider responses remain available. The progress indicator explains the next step.
- Verification, digest acknowledgment, password approval, explicit simulated submission and read-only provider checks remain separate operations. Individual recipient outcomes are visible in the same card.
- Unfinished-payment summaries and conversational follow-up use saved application records. Processing and unknown outcomes are described as unresolved. Reloading preserves the draft, source link and outcomes; polling reads saved state rather than claiming provider verification.
- Payment history, Activity/CSV and fictional spending insights remain accessible as secondary views. Mobile navigation uses a menu; Sign out stays in the header. No dashboard statistics precede the agent.

## Payment boundary

There is no payment-engine rewrite. The sole change in `payments.ts` is an optional conversation source ID checked and linked in the existing draft-creation database reducer. Amount validation and limits remain intact. Approval, execution, digest binding, one-use nonce, OTP finalization, recipient identity checks, reconciliation and provider adapters are unchanged.

No live configuration was changed, no banking provider was added and no real payment was attempted. All browser/HTTP tests explicitly select fixture mode and clear provider/model keys. Fictional accounts and simulated verification/outcomes are disclosed throughout.

## Genuine model versus deterministic behavior

| Interaction                                               | With a server-configured OpenAI/Gemini model                                                                                                   | Without model credentials                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Natural-language request                                  | A genuine adapter request classifies intent and extracts untrusted fields; strict Zod validation remains mandatory                             | A deliberately limited regular-expression parser recognizes supported commands                                              |
| Clarification                                             | The model may phrase a bounded question about missing details; numeric or outcome-bearing wording is discarded in favor of the server question | Friendly server-written questions plus an editable proposal; explicit `name:`, `amount:`, `bank:` and `account:` follow-ups |
| Screenshot extraction                                     | Genuine model vision call for PNG/JPEG/WebP; persisted unverified proposal; manual review required                                             | Attachment action explains the configuration requirement and offers pasted details or manual entry                          |
| Money totals, fees, spending and statuses                 | Deterministic server calculations and persisted authoritative records                                                                          | Same                                                                                                                        |
| Verification, approval, submission, OTP or reconciliation | Existing authenticated server endpoints, never model authority                                                                                 | Same                                                                                                                        |

The persistent indicator says either **Demo parser · limited commands · no AI model connected**, or that OpenAI/Gemini is **configured**. Configuration is not presented as a successful connection. Each saved assistant turn records model/demo provenance. A failed model request produces an error, retains the composer input, and does not silently fall back or create a fake successful response.

Configure `AI_PROVIDER=openai` or `gemini`, `AI_API_KEY` and optional `AI_MODEL` on the server using the existing `.env.example` instructions, then restart. These values are never collected in the browser. Fixture build and tests require no credentials.

**No real OpenAI/Gemini call was made in this environment.** Model contract tests use mocked adapter transport, including invalid output and provider failures. Financial narration remains deterministic even in model mode. The clarification wording filter is a bounded presentation safeguard, not a general-purpose guarantee about arbitrary model text.

## Verification

| Check                  | Result                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | **82 passed**: all 72 original tests plus 10 targeted conversation tests                                                                                  |
| `npm run typecheck`    | Passed                                                                                                                                                    |
| `npm run lint`         | Passed                                                                                                                                                    |
| `npm run build`        | Production webpack build passed                                                                                                                           |
| `npm run test:http`    | Passed: authentication, route protection, verification, approval, explicit submission, duplicate rejection, reconciliation, persisted chat status and CSV |
| `npm run test:browser` | Passed: original two-session digest/acknowledgment safety tests plus the complete chat journey at all three widths                                        |

The new browser script uses the production build and actual fixture backend, not intercepted success responses. For **1440×1000, 390×844 and 320×740**, it verifies:

1. Natural-language request → meaningful missing-field clarification → empty proposal.
2. Explicit fictional Ada/Chidi selection with supported ₦500/₦700 amounts.
3. Edited proposal survives reload; saved batch retains “Pay my bills” as its source.
4. Verification → acknowledgment and operator-password approval → separate submission. Chat and verification make no approval or execution requests; approval alone makes no execution request.
5. Simulated submission → provider check → Ada successful, Chidi processing.
6. Pending follow-up explains unresolved outcomes, which remain persisted after reload.
7. Rendered body is pitch black, primary controls are white and computed text/background/border/outline colors are grayscale with no gradients. No document or conversation horizontal overflow; composer and Sign out stay within the viewport. At 320px it also checks secondary navigation, truthful attachment unavailability and actual Sign out. No browser runtime errors were observed.

The retained original browser test separately uses one controlled presentation response to check a confirmed fee renders as ₦10; this is clearly identified in its output and is not evidence of a genuine provider call.

See [machine-readable browser results](docs/screenshots/browser-results.json) and [verification output](docs/verification.txt). The first sandbox-only unit run could not spawn the existing restart-test subprocesses; rerunning with runtime network/process permission passed. No tests were removed or skipped.

## Screenshots

Each view was captured from the production fixture application; no real account or model data was used.

| View                 | Desktop                                           | 390px                                              | 320px                                              |
| -------------------- | ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Conversation welcome | [Desktop](docs/screenshots/desktop-welcome.png)   | [390px](docs/screenshots/mobile-390-welcome.png)   | [320px](docs/screenshots/mobile-320-welcome.png)   |
| Missing details      | [Desktop](docs/screenshots/desktop-missing.png)   | [390px](docs/screenshots/mobile-390-missing.png)   | [320px](docs/screenshots/mobile-320-missing.png)   |
| Editable proposal    | [Desktop](docs/screenshots/desktop-proposal.png)  | [390px](docs/screenshots/mobile-390-proposal.png)  | [320px](docs/screenshots/mobile-320-proposal.png)  |
| Reviewed batch       | [Desktop](docs/screenshots/desktop-review.png)    | [390px](docs/screenshots/mobile-390-review.png)    | [320px](docs/screenshots/mobile-320-review.png)    |
| Persisted follow-up  | [Desktop](docs/screenshots/desktop-follow-up.png) | [390px](docs/screenshots/mobile-390-follow-up.png) | [320px](docs/screenshots/mobile-320-follow-up.png) |

## Remaining limitations / P1

- The credential-free parser is intentionally limited. Arbitrary conversation and image extraction need a configured model and an actual connectivity check in the target environment.
- Attachments support images only. PDF/CSV ingestion, conversation branching and richer streaming replies are deferred.
- A manually opened new-payment editor is not persisted until saved; conversational proposal edits are. Pre-existing batches without conversation metadata appear as saved payments, since their original request cannot be reconstructed reliably.
- Concurrent edits to the same incomplete proposal in different browser sessions use the latest saved write; a collaborative edit/conflict UI is deferred. Saved payment reviews still enforce the existing digest protections.
- Chidi intentionally remains processing in the fixture adapter. There is no fabricated completion or automatic payment retry. Real provider/live readiness remains outside this experience change.
