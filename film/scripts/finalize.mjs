import { execFileSync } from "node:child_process";
import { rename } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  movie = join(
    root,
    "deliverables",
    process.argv[2] || "agus-aporia-demo-final.mp4",
  );
const info = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=pix_fmt,color_range",
      "-of",
      "json",
      movie,
    ],
    { encoding: "utf8" },
  ),
).streams[0];
if (info.pix_fmt === "yuvj420p" || info.color_range === "pc") {
  const tmp = join(root, "deliverables/agus-aporia-compatible.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      movie,
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      "scale=in_range=full:out_range=tv,format=yuv420p",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-threads",
      "3",
      "-movflags",
      "+faststart",
      tmp,
    ],
    { stdio: "inherit" },
  );
  await rename(tmp, movie);
  console.log(
    "Converted full-range render to standard limited-range H.264/yuv420p with fast start.",
  );
} else console.log("Master is already standard yuv420p.");
