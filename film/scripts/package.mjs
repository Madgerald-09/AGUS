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
function add(start, end, text, body, source) {
  captions.push(
    `${captions.length + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n${body || ""}\n`,
  );
  table.push(
    `| ${stamp(start).slice(3, 8)}–${stamp(end).slice(3, 8)} | ${end - start}s | ${text} ${body || ""} | ${source} |`,
  );
}
for (const s of scenes) {
  const end = cursor + s.seconds;
  if (s.kind === "intro") {
    add(0, 3, "You sent the money.", "", "Original brand animation");
    add(3, 6, "But did it arrive?", "", "Original brand animation");
    add(
      6,
      11,
      "And when you’re paying several people?",
      "",
      "Original brand animation",
    );
    add(
      11,
      15,
      "agus.",
      "A clearer way to follow through.",
      "Original brand animation",
    );
  } else if (s.kind === "outro") {
    add(
      cursor,
      cursor + 6,
      "agus.",
      "Your money, and what's next.",
      "Original brand animation",
    );
    add(
      cursor + 6,
      end,
      "A PROJECT BY APORIA",
      "Gerald · Francis · Lucy — HACKAHOLICS 7.0 · 2026",
      "Final credit slate",
    );
  } else {
    let body = s.body;
    if (s.shot === "03-food")
      body += " Food spending: ₦36,600. Fictional ledger.";
    if (s.shot === "04-totals")
      body += " Income: ₦300,000. Expenses: ₦131,600. Fictional ledger.";
    if (s.shot === "12-outcomes")
      body += " Ada: successful. Chidi: processing. Local simulation only.";
    add(cursor, end, s.title.replaceAll("\n", " "), body, s.shot);
  }
  cursor = end;
}
await mkdir(join(root, "deliverables"), { recursive: true });
await writeFile(
  join(root, "deliverables", "captions-final.srt"),
  captions.join("\n"),
);
await writeFile(
  join(root, "SHOTLIST.md"),
  table.join("\n") +
    "\n\nAll product scenes use genuine captures; static holds and detail magnification extend reading time. Captions are editorial context, not substituted model responses.\n",
);
console.log(`Packaged captions and shot list: ${cursor}s.`);
