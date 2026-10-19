# AGUS visual direction v1.1

Bounded revision based on PR #26 at `f2b17be2b1f28cfb4c568173d11058d3c1e3c29a`, on branch `feat/agus-visual-v1-1`. Issue #27 takes visual precedence over #25. The founder approved the plan with no permanent composer accuracy note and three or four starter chips according to available space.

## Changes

- Layered near-black surfaces and AGUS Blue actions with dark button text.
- Centered welcome/composer; compact chips; collapsed desktop navigation and mobile history drawer.
- Guest conversation at the fictional demo's default entry point. The existing payment workspace remains reachable explicitly and through the originating chat's handoff.
- Working shared-operator sign-in before sending, with the draft retained and no automatic send.
- Secondary tools and provider configuration behind navigation disclosures; one persistent demo indicator; material result-specific caveats retained.
- Matching payment surfaces, explicit review stages, one Return to chat action and preserved draft return.
- No generic composer accuracy paragraph. Voice disclosure is contextual to the existing supported voice action; no new voice implementation.

Financial calculations, narration validation, financial authorization, SQL history and the payment engine are unchanged. Typed financial presentation, complete evidence, factual fallback, separate approval/submission, stale-approval invalidation, unresolved outcomes and emergency stop remain intact.

## Verification

- 100 focused tests passed across financial presentation, grounded narration, financial security, SQL chat history, login disclosures and payments.
- Lint and typecheck passed. Production build passed.
- Focused Chromium smoke at 1440×1000 and 390×844 checked guest input, sign-in without automatic sending, draft protection, navigation, exact spending amounts, partial coverage, evidence disclosure, SQL reload, account-selection clearing and payment return. Payment handoff issued zero approval or execution requests.
- Browser inference is explicitly mocked. Sessions, SQL and fictional financial facts use real application code. Genuine configured-provider inference, physical iOS/Android keyboards and screen-reader use have not been verified in this revision.

## Artwork and visual approval

The founder confirmed use of the original JPEG uploaded at commit `6a0f6a9c447b2dcf31f60985461152d17c9a3dc1`, path `WhatsApp Image 2026-10-16 at 00.42.35.jpeg`. Its bytes are preserved unchanged at `public/brand/agus-original.jpeg`.

Verified source SHA-256: `9fc18ca3f41239a703f754c3235adb530e2ba980698b0ae7f3892b633746beb0`. This is the JPEG checksum the founder subsequently authorized; the initially mentioned PNG/checksum was not present on the source branch.

The dark lockup and navigation wordmark use only exterior canvas crops and channel inversion (`255 - value`). Each export was inverted back and compared pixel-for-pixel against its original crop. No glyphs, letter spacing, period, tagline, aspect ratio or internal lockup arrangement were redrawn or altered. The black export background blends with charcoal surfaces through CSS `screen`. Exact crop bounds, dimensions and export checksums are in `public/brand/provenance.json`.

The final branded candidate passed lint, typecheck, production build, the three focused login-disclosure tests and the same two-width browser smoke. Exactly two screenshots were captured:

- [Desktop welcome · 1440×1000](welcome-1440.png)
- [Mobile welcome · 390×844](welcome-390.png)

The capture command is `AGUS_CAPTURE_WELCOME=true node scripts/browser-visual-v1-1.mjs`. It checks that the artwork has decoded and exercises the focused browser smoke without recording videos or a screenshot matrix. See `smoke-results.json` for the final run. Founder visual approval is pending. No merge or deployment occurred.
