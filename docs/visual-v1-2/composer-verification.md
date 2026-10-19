# Composer behavior verification

The founder approved the v1.2 desktop/mobile welcome screens at `a135964`; that visual design is frozen. This follow-up keeps the existing branch `feat/agus-visual-v1-1` and changes only demonstrated composer behavior issues.

## Findings and fixes

- Existing centered welcome placement, natural growth, bottom docking after submission, upward multiline growth, internal scrolling, normal desktop/mobile Enter behavior, reading-position preservation and response-focus ownership passed. Those paths were retained.
- Caret positions reset after desktop sign-in and chat switching. Selection and internal input scroll are now retained per chat in transient component memory, restored without forcing input focus, and cleared at session boundaries.
- A visual viewport shrinking to 300px while the layout viewport stayed tall left a 160px input and could place Send below the visible region. Existing compact rules now query the actual workspace height; textarea sizing is recomputed on viewport changes, including restoration after the keyboard-style viewport expands. Limits remain 160px normally and 80px in compact layouts.
- An Enter key reporting IME keyCode 229 at a composition boundary could submit unexpectedly. It is now ignored, consistent with the existing payment composer's guard.

## Verification

`node scripts/browser-composer.mjs` passes 20 focused checks: nine desktop checks at 1440×1000 and eleven touch-emulated mobile checks at 390×844. See [the machine-readable results](composer-results.json). Checks cover the welcome and conversation composers, upward growth/caps/internal scrolling, insertion points, sign-in and navigation drafts, Enter/Shift+Enter, Chromium native composition and the keyCode 229 guard, delayed-response scroll/focus ownership, visual viewport shrink/pan, and layout viewport shrink/restoration. Lint, typecheck, production build and diff checks pass.

Model responses are mocked; authentication, sessions and SQL use real application code with fictional local data. Physical iOS/Android software keyboards, assistive technology and genuine configured-provider narration remain unverified. Emulation is not recorded as a physical-device pass.

No additional screenshots, recordings or visual redesigns were produced. Financial logic, narration validation, permissions, history storage, payment authorization/submission, recovery and emergency stop are unchanged. The draft PR targets PR #26's branch, `feat/agus-approved-p0`. No merge or deployment occurred.
