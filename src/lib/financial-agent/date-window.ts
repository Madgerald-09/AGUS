import { z } from "zod";
import { lagosDateInterval } from "../financial-data/core";
import { InstantSchema, ReadFilterSchema } from "../financial-data/contracts";

type Interval = { from: string; toExclusive: string };
type Resolution =
  | { kind: "resolved"; interval: Interval }
  | { kind: "clarify" }
  | { kind: "absent" };

const months =
  "January February March April May June July August September October November December".split(
    " ",
  );
const monthPattern = months
  .map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`)
  .join("|");
// A deliberately bounded grammar. Unrecognized temporal qualifiers must not turn a
// substring (e.g. "first half of October 2026") into a full calendar month.
const dateExpression = `(?<![\\w-])(?:${monthPattern}|today|yesterday|tomorrow|week\\w*|month\\w*|quarter\\w*|year\\w*|day\\w*|date\\w*|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![\\w-])|\\b\\d{4}\\b|\\b\\d{1,2}[/:.-]\\d{1,2}\\b|\\b\\d{1,2}(?:am|pm)\\b`;
const temporal = new RegExp(
  `${dateExpression}|\\b(?:last|this|next|recent|earlier|later|before|after|since|until|through|between|half|first|second|third|final|early|late|mid|UTC|GMT|WAT|EST|EDT|PST|PDT|CET|CEST|timezone|time|exclusive|inclusive)\\b|\\b[A-Za-z_]+/[A-Za-z_]+\\b`,
  "i",
);
const timestamp =
  "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})";
const timestampWindow = new RegExp(
  `\\bfrom\\s+(${timestamp})\\s+(?:to|until)\\s+(${timestamp})(?![\\w:+-]|\\.\\d)(?:\\s*[,;]?\\s*(?:exclusive|end exclusive|exclusive end)\\b)?`,
  "i",
);

/** Resolve only the current user's explicit window, never model-supplied dates
 * or persisted prose. Calendar dates use Lagos; explicit zoned instants keep
 * their meaning. Unsupported/partial/conflicting date expressions clarify. */
export function resolveDateWindow(text: string): Resolution {
  const clean = text.replace(/\bAfrica\/Lagos\b|\bWAT\b/gi, "");
  function resolved(
    match: RegExpMatchArray,
    interval: () => Interval,
    explicitInstants = false,
  ): Resolution {
    let remainder = clean.replace(match[0], "");
    if (explicitInstants)
      remainder = remainder.replace(/\b(?:UTC|GMT)\b/gi, "");
    if (temporal.test(remainder)) return { kind: "clarify" };
    try {
      const value = interval();
      // Apply the same ordering, precision and maximum span as financial reads.
      ReadFilterSchema.parse({ accountIds: ["date-validation"], ...value });
      return { kind: "resolved", interval: value };
    } catch {
      return { kind: "clarify" };
    }
  }

  const instants = clean.match(timestampWindow);
  if (instants)
    return resolved(
      instants,
      () => {
        const schema = z.iso.datetime({ offset: true });
        return {
          from: InstantSchema.parse(
            new Date(schema.parse(instants[1])).toISOString(),
          ),
          toExclusive: InstantSchema.parse(
            new Date(schema.parse(instants[2])).toISOString(),
          ),
        };
      },
      true,
    );

  const dates = clean.match(
    /\bfrom\s+(\d{4}-\d{2}-\d{2})\s+(?:to|until)\s+(\d{4}-\d{2}-\d{2})\s*[,;]?\s*(?:exclusive|end exclusive|exclusive end)\b/i,
  );
  if (dates)
    return resolved(dates, () => lagosDateInterval(dates[1], dates[2]));

  const month = clean.match(
    new RegExp(
      `(?<![\\w-])(?:(?:in|for|during)\\s+)?(?:(?:the\\s+)?(?:full\\s+)?(?:calendar\\s+)?month\\s+of\\s+)?(${monthPattern})\\s+(\\d{4})(?![\\w-])`,
      "i",
    ),
  );
  if (month)
    return resolved(month, () => {
      const index = months.findIndex(
        (m) =>
          m.slice(0, 3).toLowerCase() === month[1].slice(0, 3).toLowerCase(),
      );
      const year = Number(month[2]);
      const from = `${month[2]}-${String(index + 1).padStart(2, "0")}-01`;
      const end = `${String(year + (index === 11 ? 1 : 0)).padStart(4, "0")}-${String(((index + 1) % 12) + 1).padStart(2, "0")}-01`;
      return lagosDateInterval(from, end);
    });

  const day = clean.match(/\b(?:on\s+)(\d{4}-\d{2}-\d{2})(?![\w-])/i);
  if (day)
    return resolved(day, () => {
      const next = new Date(`${day[1]}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return lagosDateInterval(day[1], next.toISOString().slice(0, 10));
    });

  return {
    kind: new RegExp(dateExpression, "i").test(clean) ? "clarify" : "absent",
  };
}
