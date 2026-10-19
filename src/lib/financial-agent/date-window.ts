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
 * their meaning. Last week is the completed Monday–Sunday calendar week;
 * this week/month include today through next Lagos midnight (exclusive).
 * Past/last seven days are seven local calendar days including today, with the
 * same exclusive endpoint. Unsupported/partial/conflicting expressions clarify. */
export function resolveDateWindow(text: string, now?: string): Resolution {
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

  const relative = clean.match(
    /\b(?:last month|this month|last week|this week|today|yesterday)\b/i,
  );
  if (relative && now)
    return resolved(relative, () => {
      const today = new Date(
        new Date(InstantSchema.parse(now)).getTime() + 3600000,
      )
        .toISOString()
        .slice(0, 10);
      const start = new Date(`${today}T00:00:00Z`),
        end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      switch (relative[0].toLowerCase()) {
        case "last month":
          end.setTime(start.getTime());
          end.setUTCDate(1);
          start.setUTCDate(1);
          start.setUTCMonth(start.getUTCMonth() - 1);
          break;
        case "this month":
          start.setUTCDate(1);
          break;
        case "last week":
          start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
          end.setTime(start.getTime());
          start.setUTCDate(start.getUTCDate() - 7);
          break;
        case "this week":
          start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
          break;
        case "yesterday":
          end.setTime(start.getTime());
          start.setUTCDate(start.getUTCDate() - 1);
          break;
      }
      return lagosDateInterval(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
    });

  const pastWeek = clean.match(
    /\b(?:in\s+|over\s+|during\s+)?(?:the\s+)?(?:past\s+week|(?:past|last)\s+(?:seven days|7 days))\b/i,
  );
  if (pastWeek && now)
    return resolved(pastWeek, () => {
      const instant = new Date(InstantSchema.parse(now));
      // Seven Lagos calendar days including today, ending at next local midnight.
      const today = new Date(instant.getTime() + 3600000)
        .toISOString()
        .slice(0, 10);
      const start = new Date(`${today}T00:00:00Z`);
      const end = new Date(start);
      start.setUTCDate(start.getUTCDate() - 6);
      end.setUTCDate(end.getUTCDate() + 1);
      return lagosDateInterval(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
    });

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
