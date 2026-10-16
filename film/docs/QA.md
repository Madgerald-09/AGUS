# Production checks

- Cleared application tree is checked by the capture script before recording.
- Browser assertions confirm source data, missing-field behavior, separate approval/submission, persisted unresolved outcomes and honest labels.
- Zero external browser requests and zero real model calls; execution uses local fixtures only.
- Representative opening, product, wide layout, approval and closing frames inspected for typography, disclosure visibility and layout. Example full-size stills are in `qa/`.
- `npx tsc --noEmit` passes for the production source.
- `npm run package` emits the 210-second shot list and optional SRT captions.
- `npm run verify` checks the final H.264 MP4 dimensions, 24fps, exactly 5,040 frames, 210-second duration, yuv420p pixel format, absence of audio and successful full FFmpeg decode. It writes `deliverables/verification.json` with file checksums.

The film is intentionally silent. The final master is a local deliverable; editable media and source are kept in this branch. The application is unaffected: production changes are confined to `film/`.
