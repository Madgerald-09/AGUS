import {
  financialLanguage,
  personalFinancialLanguage,
  CalculationSchema,
  AgentError,
} from "./protocol";
import type { z } from "zod";

/** These are requests for records, not evidence that records exist. Possessive
 * pronouns alone confer neither this intent nor permission to read anything. */
export function recordsRequest(text: string) {
  const conditional = /\b(?:if|hypothetical|suppose|assuming|example)\b/i.test(
    text,
  );
  const explicitRecords =
    /\b(?:actual|recorded|history|records?|connected)\b/i.test(text) ||
    /\b(?:what|how much) did I\b/i.test(text);
  if (conditional && !explicitRecords) return false;
  return (
    /\b(?:what|how much|explain|compare)\b.{0,30}\b(?:my|our|that|this|those)\b.{0,35}\b(?:balance|transactions?|receipts?|account|portfolio|returns?|spending|income|expenses?|savings)\b/i.test(
      text,
    ) ||
    /\b(?:show|find|search|retrieve|check|list|look up)\b.{0,60}\b(?:balance|transactions?|receipts?|account|payments?|spending|income|expenses?)\b/i.test(
      text,
    ) ||
    /\b(?:did I|have I|has my|was my|were my)\b.{0,40}\b(?:spen[dt]|paid|earn|earned|received|income|expenses?|savings)\b/i.test(
      text,
    ) ||
    /\b(?:show|what|how much)\b.{0,45}\b(?:I|we)\s+(?:received|spent|paid|earned)\b/i.test(
      text,
    ) ||
    /\b(?:that|those|smaller|larger|first|second)\b.{0,30}\b(?:payment|transaction|transfer|one)\b/i.test(
      text,
    )
  );
}

export function reasoningRequest(text: string) {
  if (recordsRequest(text)) return false;
  return (
    /\b(?:budget\w*|millionaire|how long.*sav\w*|should I (?:spend|invest|save)|can I afford|savings goal|I earn|my income is)\b/i.test(
      text,
    ) ||
    (/\b(?:recommend|advise)\b/i.test(text) &&
      /\b(?:money|budget|invest\w*|savings?|financial|spending)\b/i.test(
        text,
      )) ||
    (/\b(?:if|hypothetical|suppose|assuming|example)\b/i.test(text) &&
      financialLanguage(text))
  );
}

/** Calculations consume only user-supplied figures. No model expression, code,
 * identifiers or backend records can enter the calculator. Monetary arithmetic
 * uses integer kobo; rational percentage calculations round only at display. */
export function calculateIllustration(
  calculation: z.infer<typeof CalculationSchema>,
  source: string,
): string {
  const c = CalculationSchema.parse(calculation);
  const values = new Set(
    [
      ...source.matchAll(
        /(?<![\w])\d[\d,]*(?:\.\d+)?(?:\s*(?:million|thousand|k))?/gi,
      ),
    ].map((m) => {
      const n = Number(
        m[0]
          .replace(/[ ,]/g, "")
          .replace(/million/i, "e6")
          .replace(/thousand|k/i, "e3"),
      );
      return n;
    }),
  );
  const words =
    "zero one two three four five six seven eight nine ten eleven twelve".split(
      " ",
    );
  words.forEach((word, n) => {
    if (new RegExp(`\\b${word}\\b`, "i").test(source)) values.add(n);
  });
  if (/\bmillionaire\b/i.test(source)) values.add(1000000);
  function supplied(value: string | number, allowZero = false) {
    if (!(allowZero && Number(value) === 0) && !values.has(Number(value)))
      throw new AgentError("CALCULATION_UNSOURCED");
    return Number(value);
  }
  function kobo(value: string) {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }
  const money = (value: bigint) =>
    `₦${(value / 100n).toLocaleString("en-NG")}.${(value % 100n).toString().padStart(2, "0")}`;
  const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
  if (c.kind === "savings_goal") {
    supplied(c.monthlySavingsNaira);
    supplied(c.targetNaira);
    supplied(c.startingNaira, true);
    const monthly = kobo(c.monthlySavingsNaira),
      goal = kobo(c.targetNaira),
      start = kobo(c.startingNaira);
    if (monthly <= 0n) throw new AgentError("CALCULATION_INPUT");
    const months = goal > start ? (goal - start + monthly - 1n) / monthly : 0n;
    return `Using your supplied figures as assumptions: starting from ${money(start)} (${start === 0n ? "zero savings" : "assumed savings"}), saving ${money(monthly)} each month reaches ${money(goal)} in ${months} months. This assumes the entire monthly amount is saved and excludes interest and expenses.`;
  }
  supplied(c.months);
  const percent =
    c.kind === "savings_total" ? c.savingsPercent : c.annualRatePercent;
  supplied(percent);
  if (Number(percent) > 100) throw new AgentError("CALCULATION_INPUT");
  const amount = c.kind === "savings_total" ? c.incomeNaira : c.principalNaira;
  supplied(amount);
  const numerator = kobo(amount) * kobo(percent) * BigInt(c.months);
  const result = round(
    numerator,
    c.kind === "simple_interest" ? 120000n : 10000n,
  );
  return c.kind === "savings_total"
    ? `Illustration from your supplied figures: saving ${percent}% of ${money(kobo(amount))} monthly for ${c.months} months gives ${money(result)}, excluding interest. This assumes steady income and the same savings rate each month.`
    : `Illustration from your supplied figures: simple interest on ${money(kobo(amount))} at ${percent}% per year for ${c.months} months is ${money(result)}. This assumes simple interest with no fees, repayments or compounding.`;
}

/** Advice is allowed; ungrounded assertions about a person's records, identity,
 * actions, credentials and guarantees retain the existing lexical backstops.
 * An independent model review is additionally required. */
export function unsafeReasoning(text: string) {
  const withoutAdviceWords = text.replace(/\b(?:recommend\w*|should)\b/gi, "");
  return (
    personalFinancialLanguage(withoutAdviceWords) ||
    /\b(?:records? (?:show|confirm)|(?:checked|accessed|retrieved|found|reviewed) (?:your|the) (?:bank|account|transactions?)|belongs to|account holder|verified owner)\b/i.test(
      text,
    )
  );
}
