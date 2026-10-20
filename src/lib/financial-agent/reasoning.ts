import {
  financialLanguage,
  personalFinancialLanguage,
  CalculationSchema,
  AgentError,
  historicalReadIntent,
} from "./protocol";
import type { z } from "zod";

/** These are requests for records, not evidence that records exist. Possessive
 * pronouns alone confer neither this intent nor permission to read anything. */
export function recordsRequest(text: string) {
  if (historicalReadIntent(text)) return true;
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

type OperandRole =
  | "income"
  | "monthlySavings"
  | "target"
  | "starting"
  | "principal"
  | "savingsPercent"
  | "annualRate"
  | "months";

// Decimal strings and magnitude suffixes stay exact before integer-kobo math.
function decimalUnits(value: string): bigint {
  const match = value
    .replace(/,/g, "")
    .trim()
    .match(/^(\d+)(?:\.(\d{1,2}))?\s*(million|thousand|k)?$/i);
  if (!match) throw new AgentError("CALCULATION_INPUT");
  const scale = /million/i.test(match[3] ?? "")
    ? 1000000n
    : match[3]
      ? 1000n
      : 1n;
  return (
    (BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))) * scale
  );
}

/** Bounded user grammar: unsupported syntax clarifies. Never infer a unit or
 * role from numeric equality, or let a nearby number supply another field. */
function calculationOperands(source: string) {
  const result = new Map<OperandRole, bigint[]>();
  const add = (role: OperandRole, value: bigint) =>
    result.set(role, [...(result.get(role) ?? []), value]);
  if (
    /(?:negative|minus)\s+(?:₦|NGN\s*)?\d|[−–-]\s*(?:₦|NGN\s*)?\d|(?:₦|NGN)\s*[−–-]\s*\d|[$€£]|\b(?:USD|EUR|GBP|dollars?|pounds?|euros?)\b/i.test(
      source,
    )
  )
    throw new AgentError("CALCULATION_INPUT");
  if (
    /\b(?:not|never|don['’]t|doesn['’]t|isn['’]t|no longer)\s+(?:earn|save|invest|deposit|have|start|reach)\b|\b(?:not|never)\s+(?:the\s+)?(?:principal|income|salary|target|goal|rate)\b/i.test(
      source,
    )
  )
    throw new AgentError("CALCULATION_INPUT");
  // Corrections are outside this bounded grammar: do not let an earlier
  // operand remain authoritative when the superseded role cannot be proven.
  if (
    /\b(?:actually|instead|correct(?:ion|ed)?|replace|change|revise|rather)\b/i.test(
      source,
    )
  )
    throw new AgentError("CALCULATION_INPUT");
  const words =
    "zero one two three four five six seven eight nine ten eleven twelve".split(
      " ",
    );
  const text = source.replace(
    new RegExp(`\\b(${words.join("|")})\\b`, "gi"),
    (w) => String(words.indexOf(w.toLowerCase())),
  );
  const tokens = [
    ...text.matchAll(
      /(?<![\w.])(?:(₦|NGN)\s*)?(\d[\d,]*(?:\.\d+)?(?:\s*(?:million|thousand|k)\b)?)(?:\s*(%|percent\b|naira\b|kobo\b))?(?![\w.])/gi,
    ),
  ];
  // A partially recognized number (for example scientific notation) must not
  // vanish while other, older figures continue to ground the calculation.
  let unmatched = text;
  for (const token of [...tokens].reverse())
    unmatched =
      unmatched.slice(0, token.index!) +
      " ".repeat(token[0].length) +
      unmatched.slice(token.index! + token[0].length);
  if (/\d|[₦%]|\b(?:NGN|percent|naira|kobo)\b/i.test(unmatched))
    throw new AgentError("CALCULATION_INPUT");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const start = token.index!,
      end = start + token[0].length;
    // Neighboring tokens are hard boundaries, so their labels cannot migrate.
    const before = text.slice(
      i ? tokens[i - 1].index! + tokens[i - 1][0].length : 0,
      start,
    );
    const after = text.slice(end, tokens[i + 1]?.index ?? text.length);
    const value = decimalUnits(token[2]);
    const monthly =
      /^(?:\s*(?:naira)?\s*)(?:monthly|(?:every|per|a|each) month)\b/i.test(
        after,
      ) ||
      /\bmonthly\s+(?:income|savings|saving)\s*(?:is|of|:|=)?\s*$/i.test(
        before,
      );
    if (/^\s*[- ]?(?:years?|weeks?|days?)\b/i.test(after))
      throw new AgentError("CALCULATION_INPUT");
    const percent = token[3] === "%" || /percent/i.test(token[3] ?? "");
    const currency = !!token[1] || /^(?:naira|kobo)$/i.test(token[3] ?? "");
    const duration = /^\s*[- ]?months?\b/i.test(after);
    if (
      (percent && currency) ||
      ((percent || currency) && duration) ||
      (token[1] && /kobo/i.test(token[3] ?? "")) ||
      /^\s*(?:%|percent\b|naira\b|kobo\b|NGN\b|₦)/i.test(after)
    )
      throw new AgentError("CALCULATION_INPUT");
    if (duration) {
      if (
        /\b(?:earn(?:ed)?|income|salary|save|saving|savings|principal|target|goal|rate)(?:\s+(?:is|of|:|=))?\s*$/i.test(
          before,
        )
      )
        throw new AgentError("CALCULATION_INPUT");
      add("months", value);
      continue;
    }
    if (percent) {
      if (
        /\b(?:earn(?:ed)?|income|salary|principal|target|goal|starting(?: savings)?)(?:\s+(?:is|of|:|=))?\s*$/i.test(
          before,
        )
      )
        throw new AgentError("CALCULATION_INPUT");
      const savingsRate =
        /\b(?:save|saving|savings)(?:\s+(?:rate|of|is|at))?\s*$/i.test(before);
      const annual =
        /^\s*(?:annual(?:ly)?|yearly|per year|a year|p\.a\.)\b/i.test(after) ||
        /\b(?:annual|yearly)(?:\s+(?:interest|rate|of|is|at))*\s*$/i.test(
          before,
        );
      const monthlyRate =
        /\b(?:monthly|per month|a month)\b/i.test(after) ||
        /\bmonthly(?:\s+(?:interest|rate|of|is|at))*\s*$/i.test(before);
      if (savingsRate) {
        if (annual) throw new AgentError("CALCULATION_INPUT");
        add("savingsPercent", value);
      } else {
        // Monthly interest is unsupported; never relabel it as annual.
        if (monthlyRate) throw new AgentError("CALCULATION_INPUT");
        if (!annual) throw new AgentError("CALCULATION_INPUT");
        add("annualRate", value);
      }
      continue;
    }
    if (!currency) throw new AgentError("CALCULATION_UNSOURCED");
    const amount = /kobo/i.test(token[3] ?? "") ? value / 100n : value;
    if (/kobo/i.test(token[3] ?? "") && value % 100n)
      throw new AgentError("CALCULATION_INPUT");
    const income =
      /\b(?:earn(?:ed)?|income|salary)(?:\s+(?:is|of|:|=))?\s*$/i.test(before);
    const savings = /\b(?:save|saving|savings)(?:\s+(?:is|of|:|=))?\s*$/i.test(
      before,
    );
    if (monthly && /\b(?:annual|annually|yearly|per year)\b/i.test(after))
      throw new AgentError("CALCULATION_INPUT");
    const assignedBefore = [...result.values()].reduce(
      (n, values) => n + values.length,
      0,
    );
    if (monthly && income) add("income", amount);
    if (monthly && savings) add("monthlySavings", amount);
    if (/\b(?:target|goal|reach)(?:\s+(?:is|of|:|=))?\s*$/i.test(before))
      add("target", amount);
    if (
      /\b(?:starting(?: savings)?|already saved|have saved|start(?:ing)? (?:from|with|at))(?:\s+(?:is|of|:|=))?\s*$/i.test(
        before,
      ) ||
      (/\bhave\s*$/i.test(before) && /^\s*saved\b/i.test(after))
    )
      add("starting", amount);
    if (
      /\bprincipal(?:\s+(?:is|of|:|=))?\s*$/i.test(before) ||
      (/^\s+at\s*$/i.test(after) &&
        /^(?:\s*|.*\b(?:simple interest on|interest on|invest|invested|deposit)\s*)$/i.test(
          before,
        ))
    )
      add("principal", amount);
    // Unrecognized money could be a starting balance, a different currency or
    // another principal. Ask instead of defaulting through contradictory data.
    if (
      [...result.values()].reduce((n, values) => n + values.length, 0) ===
      assignedBefore
    )
      throw new AgentError("CALCULATION_UNSOURCED");
  }
  if (/\bmillionaire\b/i.test(text)) add("target", 100000000n);
  for (const values of result.values())
    if (new Set(values).size > 1) throw new AgentError("CALCULATION_INPUT");
  return result;
}

/** Only an explicit reference to the immediately preceding user figures may
 * supply a follow-up. Never search backwards through unrelated turns. */
export function calculationContext(
  text: string,
  history: { role: string; text: string }[],
) {
  if (
    !/\b(?:using|use|with)\s+(?:those|these|the same|the previous|previous|above)\s+(?:figures|assumptions|inputs|numbers)\b/i.test(
      text,
    )
  )
    return [];
  const prior = history.filter((m) => m.role === "user").at(-1);
  return prior ? [prior] : [];
}

/** Calculations consume only user-supplied figures. No model expression, code,
 * identifiers or backend records can enter the calculator. Monetary arithmetic
 * uses integer kobo; rational percentage calculations round only at display. */
export function calculateIllustration(
  calculation: z.infer<typeof CalculationSchema>,
  source: string,
): string {
  const c = CalculationSchema.parse(calculation);
  const grounded = calculationOperands(source);
  const roles: OperandRole[] =
    c.kind === "savings_goal"
      ? ["income", "monthlySavings", "target", "starting"]
      : c.kind === "savings_total"
        ? ["income", "savingsPercent", "months"]
        : ["principal", "annualRate", "months"];
  if ([...grounded.keys()].some((role) => !roles.includes(role)))
    throw new AgentError("CALCULATION_INPUT");
  function supplied(
    value: string | number,
    role: OperandRole,
    defaultZero = false,
  ) {
    const candidates = grounded.get(role) ?? [];
    const expected = decimalUnits(String(value));
    if (defaultZero && expected === 0n && !candidates.length) return;
    // Each field must have exactly one unambiguous semantic value, including
    // its currency/rate/period. Equal values in other roles prove nothing.
    if (!candidates.length || candidates.some((v) => v !== expected))
      throw new AgentError("CALCULATION_UNSOURCED");
  }
  function kobo(value: string) {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }
  const money = (value: bigint) =>
    `₦${(value / 100n).toLocaleString("en-NG")}.${(value % 100n).toString().padStart(2, "0")}`;
  const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
  if (c.kind === "savings_goal") {
    // Income-as-savings is only an illustration when no savings percentage
    // was supplied. Never discard an explicit savings constraint.
    if (grounded.has("savingsPercent"))
      throw new AgentError("CALCULATION_INPUT");
    supplied(
      c.monthlySavingsNaira,
      grounded.has("monthlySavings") ? "monthlySavings" : "income",
    );
    supplied(c.targetNaira, "target");
    supplied(c.startingNaira, "starting", true);
    const monthly = kobo(c.monthlySavingsNaira),
      goal = kobo(c.targetNaira),
      start = kobo(c.startingNaira);
    if (monthly <= 0n) throw new AgentError("CALCULATION_INPUT");
    const months = goal > start ? (goal - start + monthly - 1n) / monthly : 0n;
    return `Using your supplied figures as assumptions: starting from ${money(start)} (${start === 0n ? "zero savings" : "assumed savings"}), saving ${money(monthly)} each month reaches ${money(goal)} in ${months} months. This assumes the entire monthly amount is saved and excludes interest and expenses.`;
  }
  supplied(c.months, "months");
  const percent =
    c.kind === "savings_total" ? c.savingsPercent : c.annualRatePercent;
  supplied(
    percent,
    c.kind === "savings_total" ? "savingsPercent" : "annualRate",
  );
  if (Number(percent) > 100) throw new AgentError("CALCULATION_INPUT");
  const amount = c.kind === "savings_total" ? c.incomeNaira : c.principalNaira;
  supplied(amount, c.kind === "savings_total" ? "income" : "principal");
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
