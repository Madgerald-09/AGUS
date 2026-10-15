# Hackaholics 7.0 conversational integration

This branch adds model-generated ordinary conversation, grounded financial explanations, compact expandable payment details and truthful operation indicators. It retains the reviewed payment engine. It is prepared for an independent safety review; do not merge automatically.

## Integrated source commits

Work began from remotely verified `main` at `7a4f4edf63d4bb4c0493767e3bb7a402c9211609`. Exact diffs and ancestry confirmed that #4 and #5 were siblings based on #3. Separate merge commits preserved each original source commit:

| PR                                        | Incorporated source commit                 | Local integration merge |
| ----------------------------------------- | ------------------------------------------ | ----------------------- |
| #3 Chat-first interface                   | `b8e84e9b66cccc4e52f96536a518f070428cbf80` | `60cca1e`               |
| #4 Gemini diagnostics and inference retry | `18f4a52303ecf3cf8de819616a92cf7e18332840` | `c05005f`               |
| #5 Mobile and conversation refinements    | `2ec8b41f0fe70cae936522cc5529d2da0b197ce5` | `d2cc37b`               |

There were no content conflicts: #4 changes the adapter and adds diagnostics/tests; #5 changes the UI and browser tests. Inference-only retry, privacy protections, polling protection, input preservation, digest acknowledgment and password clearing are retained.

During validation another actor merged #5 (`b4f2d30`), #4 (`6d554de`) and #3 into `main` (`7db0bcd083cf5e1f8ee5698e6abf8c063969fce1`). That main tree was byte-for-byte identical to this branch's integrated baseline. This branch then merged that main head without content changes. No action in this task merged into main. The proposed PR now contains only the additional conversation implementation and its evidence.

## Conversation architecture and authority

`modelPlan()` now requests both a bounded structured financial plan and an optional genuine conversational response. The strict schema adds conversation/explanation intents, a response limited to 900 characters and an explicit proposal-continuation flag. Context contains the latest 16 actor-visible messages (message text capped at 1,800 characters) and up to 10 saved batches. Both Gemini and the existing OpenAI adapter retain server-side keys and the shared protected inference transport.

- Ordinary conversation can use the model's own words. A conservative prose gate rejects numbers, currencies, financial result/identity language, links and authorization language. Rejected prose gets a safe conversational fallback. Capability descriptions and roadmap limitations are composed by the server.
- Financial narration ignores model prose. Food/category totals use integer-kobo ledger calculations, and history/status use the authenticated actor's saved payment records. Unknown model categories are not echoed as factual narration. Unsaved proposals are distinguished from saved batches and submitted payments. Seeded spending is explicitly fictional.
- “I don't understand. Explain that.” uses the previous persisted assistant answer and its topic. Financial explanations are deterministic and clearly distinguish the previous snapshot from current payment state. They cannot invent a new balance, outcome or calculation.
- Structured payment extraction is still untrusted. Fields must be present in the current request or the single explicitly continued proposal. A small bank-name mapping accepts explicitly named supported banks; names alone never select accounts. Explicitly missing account details stay null even when inference invents a complete payment instruction. Account digits are not treated as amounts. Model-supplied warning claims are replaced with an unverified-review warning.
- Complete validated instructions may create only an **unverified draft**, as before. Partial instructions remain editable proposals. Image extraction continues to require explicit manual review. No model response can approve, execute, retry or finalize a payment. Financial execution, authentication, OTP, reconciliation and provider modules were not changed by this additional implementation.

`Message.topic` is optional persisted metadata and requires no database migration. Existing conversations continue to load. Non-model mode remains an explicitly labeled demonstration parser; it now handles greetings, thanks and contextual explanations without suggesting that inference occurred.

## Layout and operation feedback

Payment proposals and saved batches appear as short native expandable summaries. “Edit details” exposes the persisted proposal editor; “Review details” exposes beneficiary verification, account details, amounts, fees, acknowledgment, password approval, explicit submission, individual outcomes, OTP and reconciliation. Expanding details uses the existing conversation scroll surface. The card itself still remounts when its review digest changes, clearing acknowledgment/password; the surrounding expandable panel remains stable.

A short newest response has enough space below it to open at its beginning. Existing polling, focused-field, input preservation, immediate local user message, stale-snapshot and visual-viewport protections remain. Mobile touch targets, keyboard behavior and the single composer are retained. All colors stay black, white or grayscale.

An opt-in newline-delimited JSON response carries **operation events**, followed by the normal final result. It does not stream fabricated tokens or reasoning. The server emits “Thinking…” immediately before inference, “Preparing your draft…” during proposal construction, “Checking saved payments…”/“Checking payment status…” during saved-record queries and “Calculating spending…” during ledger calculations. Normal JSON API clients remain compatible. Stream failures expose safe errors, persist no invented answer and preserve input. The existing bounded retry still wraps inference alone.

## Validation and evidence

See [complete verification output](docs/integration/verification.txt), [required journey results](docs/integration/browser-results.json) and the retained regression suites. All payment operations were fixture simulations; no provider transfers or real money were used.

**121 tests pass across all 7 test files** (107 inherited tests plus 14 new regressions). Typecheck, lint, production build, production HTTP smoke and all browser suites pass. Browser suites run at 1440×1000, 820×900, 390×844 and 320×740. The original two-session suite separately verifies digest/password invalidation and confirmed-fee presentation.

All original tests remain. Two existing positive adapter fixtures now explicitly supply the payment fields that their mock model extracts; their original unverified-only, one-draft-after-recovery and no-approval assertions remain. New tests cover generated conversational replies, ownership, rejected financial claims, grounded explanations, missing accounts, amount provenance, proposal continuation, unsaved history, unknown categories, real activity events and private streamed failure.

Browser validation exercises the actual production Next.js app and authenticated APIs. A test-only Node preload replaces Gemini transport; it deliberately invents an account in the missing-account scenario to verify that the server discards it. The browser still performs actual draft edits, persistence/reload, recipient verification, digest acknowledgment, password approval, explicit simulated submission and reconciliation. Production never imports the preload.

| Viewport                     | Conversation                                              | Compact proposal                                              | Compact saved payment                                        | Completed conversation                                              |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1440×1000                    | [Image](docs/integration/desktop-conversation.png)        | [Image](docs/integration/desktop-compact-proposal.png)        | [Image](docs/integration/desktop-compact-payment.png)        | [Image](docs/integration/desktop-completed-conversation.png)        |
| 820×900 split/narrow desktop | [Image](docs/integration/narrow-desktop-conversation.png) | [Image](docs/integration/narrow-desktop-compact-proposal.png) | [Image](docs/integration/narrow-desktop-compact-payment.png) | [Image](docs/integration/narrow-desktop-completed-conversation.png) |
| 390×844                      | [Image](docs/integration/mobile-390-conversation.png)     | [Image](docs/integration/mobile-390-compact-proposal.png)     | [Image](docs/integration/mobile-390-compact-payment.png)     | [Image](docs/integration/mobile-390-completed-conversation.png)     |
| 320×740                      | [Image](docs/integration/mobile-320-conversation.png)     | [Image](docs/integration/mobile-320-compact-proposal.png)     | [Image](docs/integration/mobile-320-compact-payment.png)     | [Image](docs/integration/mobile-320-completed-conversation.png)     |

These screenshots show mocked Gemini inference through the real application. “Gemini configured” and “Model-assisted” are product UI states, not evidence of live provider connectivity.

## Limitations and review focus

- No genuine Gemini/OpenAI key is available here. Real model quality, availability, quota, latency and image extraction remain unverified. No live banking/provider integration was exercised.
- The prose gate is conservative lexical defense in depth, not a formal semantic guarantee about an LLM. It can replace otherwise useful responses. Independent review should challenge unusual paraphrases, multilingual replies and adversarial output. All financial authority remains in deterministic application code regardless of prose.
- Model extraction intentionally prefers blank fields over guessing. Unsupported amount phrasing or ambiguous multi-recipient follow-ups may require edits in the detail panel. This does not add an unrestricted calculator, budgeting engine, recurring scheduler or bank-account access.
- Context is bounded; very old conversational details may require restating. Financial explanations quote the previous saved answer and identify it as historical; current outcomes are obtained from saved records/reconciliation.
- Native iOS/Android system keyboards are not available in headless Chromium. The retained mobile tests use touch contexts, actual focus/key events and reduced visual viewports. Check a physical device before presenting.
- Operation events are streamed; assistant prose is delivered as one completed response. Long provider requests can remain at “Thinking…” until the existing shared 45-second inference deadline.

## Genuine Gemini testing locally

1. Run `npm ci`, then copy `.env.example` to `.env.local`.
2. Keep `PAYMENT_MODE=fixture`, all live flags false and `PAYSTACK_SECRET_KEY` empty. Generate the operator password hash with `npm run operator:password` and set `OPERATOR_PASSWORD_HASH` privately in `.env.local`.
3. Set `AI_PROVIDER=gemini`, `AI_MODEL=gemini-2.5-flash` (or a model supported by your account) and your own `AI_API_KEY` **only** in `.env.local`. Never use a `NEXT_PUBLIC_` variable for this key, commit it or paste it into chat/browser fields. Set `APP_ORIGIN=http://localhost:3000`.
4. Run `npm run dev` (or `npm run build && npm start`). Do not start the app with `--import scripts/fixtures/gemini-conversation.mjs`; that preload is only for automated mocked tests.
5. Sign in and run: “Hey.” → “What can you help me with?” → “How much did I spend on food?” → “I don't understand. Explain that.” → “Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.” Confirm the account stays blank. Expand Edit details, explicitly choose fictional details, save, verify, acknowledge, approve with the operator password and submit the simulation. Then ask “What happened to the payments I prepared earlier?” and “Thanks.”
6. Confirm genuine outbound Gemini requests in your local server/provider dashboard. If inference fails, inspect the privacy-safe server diagnostics; failures must preserve input and must not silently switch to a demo answer. Provider logs intentionally omit prompts, keys and raw error bodies.
7. For repeatable checks run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:http`, then `npm run test:browser`. Chromium must be installed; set `CHROMIUM_PATH` if needed.
