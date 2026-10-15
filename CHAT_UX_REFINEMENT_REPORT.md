# Chat UX refinement (P1)

This change extends PR #3 at `b8e84e9b66cccc4e52f96536a518f070428cbf80`. It uses `feat/chat-ux-refinement` and a separate PR against `feat/chat-first-financial-agent`, so reviewers see only the refinement. PR #3 remains unchanged and unmerged.

## What changed

The pitch-black monochrome design and temporary **Financial Agent** name remain. The welcome now leads with a smaller heading and a prominent composer, followed by four quiet suggestions. Mobile has a 48px header and one compact context row: **Simulation · no real money** and **Demo · no AI** (or the configured model provider). Opening the simulation disclosure shows the full fictional-recipient and no-funds-moved explanation. Sign out remains in the header. The emergency stop is available in secondary navigation; an active stop remains prominent in the conversation.

As soon as a message is sent, the welcome and suggestions disappear and the user's actual text appears with **Response pending**. This is a local pending message, not a fabricated persisted record or model response. Saved messages replace it after the real request and state refresh finish.

Progress is a single accessible live region adjacent to the composer. Labels describe actual operations: waiting for a configured model response or preparing a demo response, saving a draft, checking fictional recipient details, checking approval, submitting simulated transfers, checking provider outcomes, then loading saved state. Labels change on request completion, not on timers. There are no invented reasoning traces, fake AI responses, streaming tokens or automatic POST retries. Whole-message entry uses a short transition and respects reduced-motion preferences.

Typed input remains editable while awaiting a response. A successful reply clears only the text that was actually submitted; a newer draft remains intact. Failed requests and failed post-response refreshes retain input and explain that the response was not confirmed. Approval passwords are cleared immediately on submission, and the password field is disabled while the operation is pending; no delayed cleanup can erase a newly entered attempt. Password reauthentication remains mandatory. Older polling responses cannot overwrite newer snapshots, and periodic polling pauses during explicit operations.

Conversation scrolling respects the reader's position. Incoming polled messages do not pull someone away from older messages or a proposal. A new response opens at its beginning rather than the bottom of a tall financial card. **Latest messages** is an explicit shortcut when needed. It occupies its own row above the composer, so it cannot cover a focused field or intercept a financial action when focus changes.

The composer grows with text up to 128px and then scrolls internally. Mobile Enter adds a newline; Send is explicit. Desktop Enter sends and Shift+Enter adds a newline. IME composition does not send. Inputs use readable sizes, the layout follows the visual viewport, focused fields also respond to conversation-area resizing, and a dynamic viewport height cap prevents the composer from remaining below a shrunken viewport. The viewport configuration requests content resizing for mobile virtual keyboards.

Inline payment cards retain beneficiary identity, bank, account, amount, description, individual outcome, fee reserve and confirmed fees. The optional step guide and payment references are expandable, alongside the existing provider/approval record. Nothing needed for authenticated review is removed. Navigation remains secondary; no dashboard or financial feature was added.

## Financial boundary

There are **no changes** to the payment engine, providers, server authentication, API routes, model adapters, database schema, amount validation or live-payment configuration relative to PR #3. Digest-bound acknowledgment, operator password approval, one-use execution, OTP protections, identity checks and reconciliation remain intact. All verification uses fictional recipients and simulated transfers; no real payment or genuine model call was made.

The existing model/demo distinction remains truthful. The short **Demo · no AI** label describes the limited parser, and saved response provenance remains visible. A configured provider is labelled configured, not proven connected. The P1 work does not add any model capability or authority.

## Verification

- `npm test`: **82 passed**, preserving the complete existing unit/security/persistence suite.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: production webpack build passed.
- `npm run test:http`: passed against the production fixture server.
- `npm run test:browser`: passes the retained digest/acknowledgment safety tests, the original full fixture journey at all three widths, and the new P1 scenarios at all three widths.

The new browser suite starts an isolated production fixture server for each viewport: **1440×1000**, **390×844** and **320×740**. It checks:

1. Compact mobile chrome, a visible simulation summary, smaller suggestions below the composer, secondary emergency stop controls and no horizontal overflow.
2. Enter/Shift+Enter behavior, IME composition, long drafts, touch contexts and reduced visual viewports with both composer and proposal inputs focused. Focused inputs must also pass a hit test so adjacent controls cannot cover them.
3. A genuinely delayed request, immediate pending user text, an accessible operation-specific progress label and immediate removal of welcome content. The delayed request is forwarded to the real fixture backend; no successful response is manufactured.
4. Editing the next draft while a response is pending, then verifying those edits survive the real successful response.
5. Real server amount-limit rejection, retained proposal fields, wrong-password rejection, renewed explicit approval and separately submitted simulated transfers.
6. Actual fixture reconciliation outcomes: Ada successful and Chidi still processing, with references available on demand.
7. A 32-message persisted conversation, polling while reading older content, retained proposal/composer edits and the explicit Latest messages shortcut.
8. Transport failure and a successful chat response followed by a failed state refresh. Both retain typed input, and failed transport produces no saved assistant response or fallback.
9. No browser runtime errors. The original journey suite also rechecks rendered grayscale colors, pitch-black background, white primary controls, absence of gradients and visible Sign out/composer.

The retained original safety browser test uses one explicitly controlled presentation response for confirmed fee formatting; that isolated check is unchanged. The new P1 suite uses no fake AI/provider success responses. See [verification output](docs/ux-refinement/verification.txt), [original journey results](docs/ux-refinement/after/browser-results.json), and [P1 results](docs/ux-refinement/after/ux-results.json).

**Keyboard testing limitation:** headless Chromium cannot open an iOS or Android system keyboard. The tests cover touch/mobile contexts, actual focus and key events, composition, visual viewport resizing and field hit testing. Native-device keyboard and browser-toolbar behavior still need a device check. Genuine model/vision connectivity also remains outside this credential-free fixture verification.

## Before / after screenshots

The before screenshots were captured from PR #3's production build before changing the UI. The after screenshots use the refined production build. Each run uses the same supported fictional recipients and small amounts, with naturally different generated references and timestamps.

| View                   | Before                                                             | After                                                            |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Desktop welcome        | [Before](docs/ux-refinement/before/desktop-welcome.png)            | [After](docs/ux-refinement/after/desktop-ux-welcome.png)         |
| 390px welcome          | [Before](docs/ux-refinement/before/mobile-390-welcome.png)         | [After](docs/ux-refinement/after/mobile-390-ux-welcome.png)      |
| 320px welcome          | [Before](docs/ux-refinement/before/mobile-320-welcome.png)         | [After](docs/ux-refinement/after/mobile-320-ux-welcome.png)      |
| Desktop payment review | [Before](docs/ux-refinement/before/desktop-review.png)             | [After](docs/ux-refinement/after/desktop-ux-review.png)          |
| 390px payment review   | [Before](docs/ux-refinement/before/mobile-390-review.png)          | [After](docs/ux-refinement/after/mobile-390-ux-review.png)       |
| 320px payment review   | [Before](docs/ux-refinement/before/mobile-320-review.png)          | [After](docs/ux-refinement/after/mobile-320-ux-review.png)       |
| Editable proposal      | [Before, 320px](docs/ux-refinement/before/mobile-320-proposal.png) | [After, 320px](docs/ux-refinement/after/mobile-320-proposal.png) |

Additional after evidence:

| Scenario                            | Desktop                                                              | 390px                                                                 | 320px                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Pending request                     | [Desktop](docs/ux-refinement/after/desktop-ux-pending.png)           | [390px](docs/ux-refinement/after/mobile-390-ux-pending.png)           | [320px](docs/ux-refinement/after/mobile-320-ux-pending.png)           |
| Simulated submission progress       | [Desktop](docs/ux-refinement/after/desktop-ux-submission.png)        | [390px](docs/ux-refinement/after/mobile-390-ux-submission.png)        | [320px](docs/ux-refinement/after/mobile-320-ux-submission.png)        |
| Long conversation                   | [Desktop](docs/ux-refinement/after/desktop-ux-long-conversation.png) | [390px](docs/ux-refinement/after/mobile-390-ux-long-conversation.png) | [320px](docs/ux-refinement/after/mobile-320-ux-long-conversation.png) |
| Error retains input                 | [Desktop](docs/ux-refinement/after/desktop-ux-error.png)             | [390px](docs/ux-refinement/after/mobile-390-ux-error.png)             | [320px](docs/ux-refinement/after/mobile-320-ux-error.png)             |
| Reduced keyboard viewport           | —                                                                    | [390px](docs/ux-refinement/after/mobile-390-ux-keyboard.png)          | [320px](docs/ux-refinement/after/mobile-320-ux-keyboard.png)          |
| Focused proposal / reduced viewport | —                                                                    | [390px](docs/ux-refinement/after/mobile-390-ux-proposal-keyboard.png) | [320px](docs/ux-refinement/after/mobile-320-ux-proposal-keyboard.png) |
