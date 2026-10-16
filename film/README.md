# Agus · Hackaholics 7.0 demo film

A 3:30 silent product film at 1920×1080, 24fps, H.264/yuv420p MP4. Editable Remotion source and genuine application recordings. The visual treatment uses restrained monochrome, orbital brand motion, moving detail views, readable editorial captions and smooth fades. No soundtrack is required for comprehension.

Application source: final main at `3ca4cba0da4c2417df417aaba2a515c23c7e1f55`; tree `893b04995a77bc664bb9f5b20288e5be1b691bd5`. See [clearance and integration](docs/CLEARANCE.md).

## Watch and edit

- `deliverables/agus-hackaholics-7.mp4` — finished playable master (kept outside Git).
- `deliverables/poster.png` — brand frame.
- `NARRATION.md` — concise optional presentation script.
- `src/scenes.ts` — timing, chapter labels, on-screen copy.
- `src/movie.tsx`, `src/style.css` — layouts and animation.
- `public/captures/` — real product MP4 clips, PNG holds and capture evidence.
- `scripts/capture.mjs` — repeatable browser workflow with assertions, isolated database and safe configuration.

```sh
npm ci --cache /tmp/agus-npm-cache
npm run studio
npm run render
npm run still
npm run package
npm run verify
```

Chromium defaults to `/usr/bin/chromium`. Change `--browser-executable` in package scripts if necessary. The render uses 2 concurrent browser workers, then normalizes full-range output to standard yuv420p when needed. All fonts and media are local. Font license is in `public/fonts/LICENSE.txt`. Remotion usage is subject to its own package license. This edit has no network or credential dependency after installation.

## Re-record against the financial application

Use a separate checkout of the final application with its locked dependencies installed and a completed production build. Leave application source unchanged. `AGUS_APP_DIR` selects that checkout; the capture script checks its exact cleared Git tree. The application is started locally on port 3120, with a temporary database, random operator password, fixture mode, no model/payment key and all live flags false. Nothing is deployed.

```sh
# From the application checkout:
npm ci --cache /tmp/agus-npm-cache
npm run build

# From this film directory, using the actual checkout path:
AGUS_APP_DIR=/path/to/final-app npm run capture
npm run render
```

Recording requires Playwright's FFmpeg helper (`npx playwright install ffmpeg`) and system FFmpeg/ffprobe. In the managed environment the installed `/usr/bin/ffmpeg` was reused with:

```sh
mkdir -p /tmp/agus-playwright/ffmpeg-1011
ln -sf /usr/bin/ffmpeg /tmp/agus-playwright/ffmpeg-1011/ffmpeg-linux
PLAYWRIGHT_BROWSERS_PATH=/tmp/agus-playwright AGUS_APP_DIR=/workspace/agus-clearance npm run capture
```

The helper path is specific to pinned Playwright 1.61.1. Runtime passwords remain in memory and are never written to the source, manifest or logs. Recordings only show masked password controls. Raw browser masters are optional and ignored in Git.

## Evidence and representation

These are successful local fixture demonstrations of the real interface, with the offline command parser. **No genuine Gemini inference, live bank data, Paystack test API, real transfer or verified external integration is advertised.** The film says “No live AI” and “No real funds moved” throughout product footage; the closing disclosure repeats the limitation. Spending figures are fictional sample-ledger calculations. Recipient names and payment outcomes are local simulations. On-screen magnification, static holds and transition timing are editorial treatments of genuine captures. Replies and financial records were not invented for the edit.

The capture asserts missing account fields; zero approval/execution before review; approval without execution; explicit separate simulation submission; successful/processing outcomes; persistence after reload; Simulation labels; no browser errors and no external browser requests. See `public/captures/evidence.json`. No fixtures or model transport mocks were added to the financial application.

The production branch changes only `film/`. The final application on main remains untouched by film production.
