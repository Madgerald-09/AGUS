import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const source = await readFile(join(root, "src/scenes.ts"), "utf8");
const lines = source
  .replace(/export const FPS = 24;/, "")
  .replace(/export const TOTAL_FRAMES =[\s\S]*$/, "")
  .replace("export const scenes =", "return")
  .replace(/as const;/, ";");
const scenes = Function(lines)();
const stamp = (s) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")},000`;
};
let cursor = 0;
const captions = [],
  table = [
    "# Film timing and evidence",
    "",
    "| Time | Duration | Content | Source |",
    "| --- | --- | --- | --- |",
  ];
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i],
    end = cursor + s.seconds;
  const text =
    s.kind === "intro"
      ? "Agus — Your financial workspace."
      : s.kind === "outro"
        ? "Agus. Understand the source. Review the details. Stay in control."
        : s.title.replaceAll("\n", " ");
  captions.push(
    `${i + 1}\n${stamp(cursor)} --> ${stamp(end)}\n${text}\n${s.body || "Fixture demonstration · No live AI · No real money moved."}\n`,
  );
  table.push(
    `| ${stamp(cursor).slice(3, 8)}–${stamp(end).slice(3, 8)} | ${s.seconds}s | ${text} | ${s.shot || "Original brand animation"} |`,
  );
  cursor = end;
}
await mkdir(join(root, "deliverables"), { recursive: true });
await writeFile(
  join(root, "deliverables", "captions.srt"),
  captions.join("\n"),
);
await writeFile(
  join(root, "SHOTLIST.md"),
  table.join("\n") +
    "\n\nAll product scenes use genuine captures; static holds and detail magnification extend reading time. Captions are editorial context, not substituted model responses.\n",
);
console.log(`Packaged captions and shot list: ${cursor}s.`);
