import { execFileSync } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
  movie = join(
    root,
    "deliverables",
    process.argv[2] || "agus-aporia-demo-final.mp4",
  );
const data = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", movie],
    { encoding: "utf8" },
  ),
);
const video = data.streams.find((s) => s.codec_type === "video");
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(video.codec_name, "h264");
assert.equal(video.pix_fmt, "yuv420p");
assert.equal(video.color_range, "tv");
assert.equal(video.r_frame_rate, "24/1");
assert.equal(data.streams.filter((s) => s.codec_type === "audio").length, 0);
assert.ok(Math.abs(Number(data.format.duration) - 210) < 0.1);
assert.equal(Number(video.nb_frames), 5040);
execFileSync("ffmpeg", ["-v", "error", "-i", movie, "-f", "null", "-"], {
  stdio: "pipe",
});
const evidence = JSON.parse(
  await readFile(join(root, "public/captures/evidence.json")),
);
assert.equal(evidence.sourceCommit, "3ca4cba0da4c2417df417aaba2a515c23c7e1f55");
assert.equal(evidence.sourceTree, "893b04995a77bc664bb9f5b20288e5be1b691bd5");
assert.equal(evidence.mode, "fixture");
assert.equal(evidence.aiProvider, "none");
assert.equal(evidence.genuineModelCalls, 0);
assert.equal(evidence.externalBrowserRequests, 0);
assert.deepEqual(evidence.browserErrors, []);
assert.deepEqual(evidence.finalStatuses, ["successful", "processing"]);
const masterBytes = await readFile(movie);
const atoms = [];
for (let at = 0; at + 8 <= masterBytes.length;) {
  let size = masterBytes.readUInt32BE(at);
  atoms.push(masterBytes.toString("ascii", at + 4, at + 8));
  if (size === 1) size = Number(masterBytes.readBigUInt64BE(at + 8));
  if (size < 8) break;
  at += size;
}
assert.ok(
  atoms.indexOf("moov") >= 0 && atoms.indexOf("moov") < atoms.indexOf("mdat"),
);
const hashes = {};
for (const name of [
  process.argv[2] || "agus-aporia-demo-final.mp4",
  "agus-aporia-poster.png",
  "captions-final.srt",
]) {
  const path = join(root, "deliverables", name);
  hashes[name] = {
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    bytes: (await stat(path)).size,
  };
}
const originalManifest = JSON.parse(
  await readFile(join(root, "deliverables/verification.json")),
);
const fallbackHash = createHash("sha256")
  .update(await readFile(join(root, "deliverables/agus-hackaholics-7.mp4")))
  .digest("hex");
assert.equal(
  fallbackHash,
  originalManifest.hashes["agus-hackaholics-7.mp4"].sha256,
);
const report = {
  originalFallbackPreserved: true,
  fallbackSha256: fallbackHash,
  passed: true,
  video: {
    width: 1920,
    height: 1080,
    fps: 24,
    durationSeconds: 210,
    frames: 5040,
    codec: "H.264",
    pixelFormat: "yuv420p",
    silent: true,
    fullDecode: "passed",
    fastStart: true,
    colorRange: "limited",
  },
  sourceCommit: evidence.sourceCommit,
  sourceTree: evidence.sourceTree,
  mode: "fixture",
  liveAI: false,
  realFundsMoved: false,
  hashes,
};
await writeFile(
  join(root, "deliverables/verification-final.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
