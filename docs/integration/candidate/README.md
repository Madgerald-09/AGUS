# AGUS v1.2 integration candidate

Branch: `integration/agus-v1-2-candidate-20261019`, targeting `main` as a draft. No merge, deployment or production transfer is authorized or performed. Exact source commit and check results are recorded in [validation.json](validation.json).

## Actual ancestry and reconciliation

Fetched all remote branch and PR head refs before integrating. Closure was not used to decide inclusion. PR #28 at `7f714a9a645c5222f96b9a2075869551d0aab5b4` is the starting point, rather than a replay of the historical PRs.

| Work | Verified relationship to #28 | Candidate treatment |
| --- | --- | --- |
| #13 architecture (`45f5531`) | Ancestor | Inherited |
| #14 financial data and repairs (`a602066`) | Merged ancestor through #18 | Inherited; calculations unchanged |
| #15 baseline lint/bank retry (`7048772`) | Merged ancestor through #18 | Inherited; duplicate bank loader excluded during main reconciliation |
| #16 fictional QA scenarios (`5d25d24`) | Separate documentation-only branch, absent | Merged its two documents |
| #17 read-only orchestration (`043fa19`) | Not an ancestor; all three commits are patch-equivalent to #19's incorporated commits | Inherited equivalents; no replay |
| #18 persistence/API integration (`2283a7d`) | Ancestor | Inherited |
| #19 conversational integration (`7f8d53d`) | Ancestor | Inherited |
| #20 product grounding (`95ef511`) | Ancestor | Inherited |
| #21 Lagos calendar intervals (`6950951`) | Ancestor | Inherited |
| #22 historical payment routing (`5f00ab6`) | Ancestor | Inherited |
| #23 financial education (`d4e0e58`) | Ancestor | Inherited |
| #24 saved workspace (`489c90e`) | Ancestor | Inherited; expired-context write boundary repaired |
| #26 P0 runtime/evidence through `f2b17be` | Ancestor | Inherited |
| #26 later parent head `6a0f6a9c447b2dcf31f60985461152d17c9a3dc1` | Diverged after `f2b17be`; one root JPEG only | Merged original upload; no missing source changes |
| #28 v1.2 and composer (`7f714a9`) | Approved starting head | Preserved |
| Fetched `main` (`292d0b192c8be60589d92fe08dc80a8e25c1d7c5`) | Diverged from the stack at `a73d96c`; includes newer voice/workspace commits `96c413c` and `a85d9af` | Merged current main, resolving only dashboard/CSS conflicts |

`git cherry pr/28 pr/17` reports all three original #17 commits with `-`: `d79b077 → b33a7f6`, `38316bd → e5f603b`, `043fa19 → 8eee6f5`. These are equivalent patches, not missing capabilities.

The later parent JPEG and `public/brand/agus-original.jpeg` both have SHA-256 `9fc18ca3f41239a703f754c3235adb530e2ba980698b0ae7f3892b633746beb0`. Existing crops, exports and provenance remain unchanged. The root upload is retained for ancestry completeness.

At fetch time `origin/Gerald` and `origin/main` both pointed to `292d0b1`; there were no Gerald-only commits at that snapshot. Integration used `origin/main`, never Gerald as a merge source. No write to Gerald, main or any historical PR branch occurs. Future voice work is not included.

### Resolved source conflicts and integration fixes

- Kept v1.2's charcoal/blue tokens, original logo, navigation, welcome, composer behavior, payment review collapse and originating-chat return. Rejected the conflicting green workspace theme from main.
- Retained main's compatible browser dictation, provider transcription fallback and optional spoken replies in the existing payment workspace. The approved financial-conversation composer is unchanged, with no new microphone control. Kept the single authenticated bank loader and its retry state.
- Preserved multiline browser dictation input and restored guards against late voice results on stop, send, navigation, logout and unmount. Pending provider transcription cannot populate a later workspace after invalidation. Voice never sends or authorizes a payment.
- Found an actual cross-version persistence conflict: #24 reset expired context revisions to 1, while the earlier generic adapter promised tombstones. Old revision-1 writers could match a renewed row. Generic storage retains tombstones by default; the conversational workspace explicitly opts into renewal. Numeric compare-and-swap now requires the exact observed row expiry as well as revision and scope. A per-turn adapter prevents an earlier lifetime's writer from overwriting renewed context. SQL regressions verify concurrent renewal, stale-writer rejection and a current writer's success. Display history remains independent of financial authority.

Payment calculations, the financial-data module, payment engine and Paystack adapter are byte-for-byte unchanged from #28. The conversation renderer, CSS, model adapter, narration validation, routing and approved composer implementation are also unchanged. No new bank integration or financial algorithm was introduced.

## Working paths and validation

- Authenticated ordinary conversation and financial education through the existing model adapter; account-scoped tools and durable SQL chat history with owner isolation, permission rechecks and restart recovery.
- Deterministic integer-kobo calculations, transaction searches, ambiguous-name clarification and multi-step search → current transaction details → limited synthetic payment evidence. Lagos calendar correction and historical-read routing remain active.
- Grounded financial presentation with accepted mocked narration, labeled factual fallback and expandable evidence. Backend values and source references remain authoritative.
- Explicit handoff to editable payment details, fixture beneficiary verification, password reauthentication/approval, separate submission and individual outcomes. Successful and unresolved processing outcomes survive reload; original chat navigation and transient draft continuity work.
- Mode disclosures, live gates, emergency stop, timeout/unknown status and no automatic submission retry remain enforced by the existing payment tests. Production HTTP smoke verifies two recipients, duplicate rejection, reconciliation and saved status conversation.

Focused suite: **316 tests / 11 files pass**. Production build, lint, standalone typecheck and diff checks pass. Production Chromium journeys pass at **1440×1000** and touch-emulated **390×844**, with seven integration groups each and no page errors. No new screenshots, recordings, visual matrices or broad audit were generated. Existing historical evidence remains in the inherited tree.

See [browser-results.json](browser-results.json) and [validation.txt](validation.txt). Model classification, planning and narration in browser tests are explicitly mocked; auth, sessions, SQL, tools, calculations and fixture payment operations execute application code. Existing transport tests mock external providers. No model or bank network call is treated as verified by these tests.

The first sandboxed build could not read a spawned TypeScript configuration process; restart tests also required subprocess access. They passed using the supported execution permission. Initial focused testing exposed the expired-context conflict described above. The new browser harness was aligned with v1.2's sign-in controls and established ambiguity/transient-draft contracts; it waits for React to render synthetic speech events.

## Remaining limits

- **Genuine model behavior remains unverified:** no legitimate model credential is configured in this environment. Natural conversation and narration require private provider configuration and permitted provider egress. The unavailable-model gate is explicit; mocked success does not establish live model quality.
- **Financial accounts and evidence are fictional.** The financial conversation remains explicitly gated to fixture payment mode. Test/live payment modes retain the original payment workspace; there is no real-bank transaction source or account linking.
- Shared operator authentication is preserved: people sharing that identity share its chat/payment history. Completed turns persist; unsent drafts are memory-only and intentionally clear on full reload. Agent context expires after 15 minutes and is not reconstructed as authority from display history.
- New-chat voice improvements remain Gerald's work. Native speech services, provider audio, physical mobile keyboards and actual screen readers were not exercised; the browser dictation lifecycle was mocked. Embedded PGlite supports one Node process; managed PostgreSQL and live provider operation were not tested.

These are limitations of the existing product/runtime, not reasons to silently substitute new implementations. Keep this candidate draft.

## Run locally

Use Node 24 (validated with 24.19.0) and npm. In a fresh checkout of this branch:

```sh
npm ci
cp .env.example .env.local
npm run operator:password
```

Privately edit `.env.local`: put the helper's hash in `OPERATOR_PASSWORD_HASH`; set `FINANCIAL_DEMO_ENABLED=true`, `PAYMENT_MODE=fixture`, and keep the live transfer flags false and Paystack key empty. Keep the default `DATABASE_URL=pglite://.data/agent` and `APP_ORIGIN=http://localhost:3000`. For natural conversation, set `AI_PROVIDER=gemini` or `openai`, a supported `AI_MODEL`, and your legitimate `AI_API_KEY`. Do not paste credentials into a chat. `AI_PROVIDER=none` allows the app to start but returns `MODEL_NOT_CONFIGURED` for conversation, while the separate payment workspace retains its labeled limited parser.

```sh
npm run db:migrate
npm run dev
# Open http://localhost:3000. Sending a guest message opens operator sign-in.
```

For a local production process, stop dev first, then `npm run build && npm start`. PGlite must be used by one server process at a time. For credential-free reproducible verification:

```sh
npm run test:integration
npm run lint
npm run typecheck
npm run build
npm run test:http
npm run test:browser:integration
```

The HTTP/browser checks create temporary databases, generate private test passwords, force safe fixture settings and never submit a real payment. Override `CHROMIUM_PATH` if needed. No deployment command is part of this workflow.
