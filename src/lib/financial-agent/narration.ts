import { z } from "zod";
import { AgentError } from "./protocol";
import type { Fact } from "./facts";
import type { FinancialPresentation } from "./presentation";

export const NarrationSchema = z.strictObject({
  paragraphs: z
    .array(
      z.strictObject({
        resultIds: z.array(z.string()).min(1).max(5),
        text: z.string().trim().min(1).max(2400),
      }),
    )
    .min(1)
    .max(5),
});

/** Only fixed categories and token roles leave the validator, never draft text,
 * values, identifiers, hashes, provider labels or schema issue payloads. */
export type NarrationDiagnostic = {
  version: 1;
  stage: "schema" | "reference" | "clauses" | "claim" | "limits";
  category:
    | "malformed_schema"
    | "unknown_result"
    | "sentence_result_mismatch"
    | "unused_result"
    | "unknown_slot"
    | "embedded_limit"
    | "literal_value"
    | "unsupported_structure"
    | "missing_required_limit";
  paragraphIndex?: number;
  clauseIndex?: number;
  structure?: Array<
    | "text"
    | "period"
    | "question"
    | "exclamation"
    | "comma"
    | "semicolon"
    | "colon"
    | "expenses_slot"
    | "income_slot"
    | "difference_slot"
    | "scope_slot"
    | "count_slot"
    | "record_slot"
    | "limit_slot"
    | "unknown_slot"
  >;
};
export class NarrationError extends AgentError {
  constructor(
    code: string,
    public readonly diagnostic: NarrationDiagnostic,
  ) {
    super(code);
  }
}

function structure(text: string): NarrationDiagnostic["structure"] {
  const punctuation = {
    ".": "period",
    "?": "question",
    "!": "exclamation",
    ",": "comma",
    ";": "semicolon",
    ":": "colon",
  } as const;
  return (text.match(/\{\{[^}]+\}\}|[.!?,;:]|[^{}.!?,;:]+|[{}]/g) ?? [])
    .filter((token) => token.trim())
    .slice(0, 24)
    .map((token) => {
      if (Object.hasOwn(punctuation, token))
        return punctuation[token as keyof typeof punctuation];
      if (!token.startsWith("{{")) return "text";
      const role = token.match(
        /^\{\{r\d+\.(expenses|income|difference|scope|count)\}\}$/,
      )?.[1];
      if (role)
        return `${role}_slot` as
          | "expenses_slot"
          | "income_slot"
          | "difference_slot"
          | "scope_slot"
          | "count_slot";
      if (/^\{\{r\d+\.limit\d+\}\}$/.test(token)) return "limit_slot";
      return /^\{\{r\d+\.(?:name|amount|direction|status)\d+\}\}$/.test(token)
        ? "record_slot"
        : "unknown_slot";
    });
}

/** Evidence-constrained prose authoring. Whole-sentence grammar checks prove
 * supported propositions independently of a model reviewer. Values and labels
 * are inserted only after validation. Unrecognized claims fail closed. */
export function narrationContract(facts: Fact[]) {
  const slots: Record<string, string> = {};
  const sentences: { pattern: string; resultId: string }[] = [];
  const examples: { resultId: string; text: string }[] = [];
  const required: string[] = [];
  const allow = (resultId: string, pattern: string, ...texts: string[]) => {
    sentences.push({ resultId, pattern });
    examples.push(...texts.map((text) => ({ resultId, text })));
  };
  const literal = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [i, fact] of facts.entries()) {
    const r = fact.presentation,
      key = `r${i}`;
    const slot = (name: string) => `{{${key}.${name}}}`;
    const token = (name: string, value: string) => {
      const t = slot(name);
      slots[t] = value;
      return literal(t);
    };
    const scope = token("scope", r.scope);
    allow(
      r.resultId,
      `(?:The figures cover|These records cover) ${scope}\\.`,
      `These records cover ${slot("scope")}.`,
    );
    if (r.type === "calculate_spending") {
      const expense = token("expenses", r.metrics[0].value),
        income = token("income", r.metrics[1].value),
        diff = token("difference", r.metrics[2].value);
      // Finite clauses compose only backend-proven propositions. Slot roles
      // remain part of each grammar rule; no arbitrary prose wildcard is used.
      const prefix = "(?:(?:In|Based on) the available records, )?";
      const spending = `(?:(?:(?:Your|The) )?(?:total )?(?:expenses|spending) (?:total|are|were|was|come to|came to|amount to|amounted to)|You spent) ${expense}`;
      const received = `(?:(?:(?:your|the) )?(?:total )?income (?:totals|is|was|comes to|came to|amounts to|amounted to)|you received) ${income}`;
      const differenceLabel =
        r.metrics[2].label === "Filtered difference"
          ? "filtered difference"
          : "(?:net )?difference";
      const leaving = `(?:, leaving a ${differenceLabel} of ${diff})?`;
      allow(
        r.resultId,
        `${prefix}${spending}(?:(?:,? (?:and|while) |; )${received})?${leaving}\\.`,
        `Your total spending was ${slot("expenses")}, while your total income was ${slot("income")}.`,
        `In the available records, spending came to ${slot("expenses")}; income amounted to ${slot("income")}.`,
      );
      allow(
        r.resultId,
        `${prefix}${received}\\.`,
        `Income amounted to ${slot("income")}.`,
      );
      allow(
        r.resultId,
        `${prefix}you spent ${expense} and received ${income}${leaving}\\.`,
        `Based on the available records, you spent ${slot("expenses")} and received ${slot("income")}.`,
      );
      allow(
        r.resultId,
        `(?:The ${differenceLabel} (?:is|was|comes to|came to|amounts to)|This leaves a ${differenceLabel} of) ${diff}\\.`,
        `The ${r.metrics[2].label === "Filtered difference" ? "filtered difference" : "net difference"} is ${slot("difference")}.`,
      );
      allow(
        r.resultId,
        `(?:In the available records, )?(?:expenses|Expenses) (?:total|are|come to) ${expense}(?:,? (?:and|while) income (?:totals|is|comes to) ${income})?\\.`,
      );
      allow(
        r.resultId,
        `(?:The records show|These records show) expenses of ${expense} and income of ${income}\\.`,
      );
      allow(
        r.resultId,
        `Based on the available records, you spent ${expense} and received ${income}\\.`,
      );
      allow(r.resultId, `Income (?:totals|is|comes to) ${income}\\.`);
      allow(
        r.resultId,
        `The ${r.metrics[2].label.toLowerCase()} (?:is|comes to) ${diff}\\.`,
      );
      const negative = r.metrics[2].value.startsWith("-"),
        zero = r.metrics[2].value === "₦0.00";
      if (!negative && !zero)
        allow(
          r.resultId,
          `Income exceeded expenses by ${diff} in these records\\.`,
          `Income exceeded expenses by ${slot("difference")} in these records.`,
        );
      allow(
        r.resultId,
        zero
          ? "Income and expenses are equal in these records\\."
          : negative
            ? "Expenses exceeded income in these records\\."
            : "Income exceeded expenses in these records\\.",
        zero
          ? "Income and expenses are equal in these records."
          : negative
            ? "Expenses exceeded income in these records."
            : "Income exceeded expenses in these records.",
      );
    }
    if (r.type === "search_transactions" || r.type === "get_transaction") {
      if (r.records.length)
        allow(
          r.resultId,
          `(?:I found|The available data contains) ${token("count", String(r.records.length))} (?:matching|candidate) records?\\.`,
          `I found ${slot("count")} candidate records.`,
        );
      else
        allow(
          r.resultId,
          "No matching records were found in the available data\\.",
          "No matching records were found in the available data.",
        );
      r.records.forEach((record, n) => {
        const name = token(`name${n}`, record.name),
          amount = token(`amount${n}`, record.amount),
          direction = token(`direction${n}`, record.direction),
          status = token(`status${n}`, record.status);
        allow(
          r.resultId,
          `${name} has a ${direction} record of ${amount}\\.`,
          `${slot(`name${n}`)} has a ${slot(`direction${n}`)} record of ${slot(`amount${n}`)}.`,
        );
        allow(
          r.resultId,
          `The source lists the record for ${name} as ${status}\\.`,
          `The source lists the record for ${slot(`name${n}`)} as ${slot(`status${n}`)}.`,
        );
      });
      if (r.records.length > 1)
        allow(
          r.resultId,
          "Please choose a candidate to inspect its details\\.",
          "Please choose a candidate to inspect its details.",
        );
    }
    r.limits.forEach((limit, n) => {
      const t = `{{${key}.limit${n}}}`;
      required.push(t);
      slots[t] = /[.!?]$/.test(limit) ? limit : `${limit}.`;
      allow(r.resultId, literal(t), t);
    });
    if (r.type === "find_payment_evidence")
      allow(
        r.resultId,
        "The available evidence cannot confirm recipient bank credit\\.",
        "The available evidence cannot confirm recipient bank credit.",
      );
  }
  return { slots, sentences, required, examples };
}

export function acceptNarration(raw: unknown, facts: Fact[]): string[] {
  const parsed = NarrationSchema.safeParse(raw);
  if (!parsed.success)
    throw new NarrationError("NARRATION_SCHEMA", {
      version: 1,
      stage: "schema",
      category: "malformed_schema",
    });
  const answer = parsed.data,
    contract = narrationContract(facts);
  const allowedIds = new Set(facts.map((f) => f.resultId)),
    used = new Set<string>(),
    referenced = new Set<string>();
  const paragraphs = answer.paragraphs.map((p, paragraphIndex) => {
    const fail = (
      code: string,
      stage: NarrationDiagnostic["stage"],
      category: NarrationDiagnostic["category"],
      clauseIndex?: number,
      clause?: string,
    ): never => {
      throw new NarrationError(code, {
        version: 1,
        stage,
        category,
        paragraphIndex,
        ...(clauseIndex === undefined ? {} : { clauseIndex }),
        ...(clause === undefined ? {} : { structure: structure(clause) }),
      });
    };
    if (
      new Set(p.resultIds).size !== p.resultIds.length ||
      p.resultIds.some((id) => !allowedIds.has(id))
    )
      fail("NARRATION_REFERENCE", "reference", "unknown_result");
    // Normalize formatting, then consume every non-whitespace character before
    // inserting data. A lone redundant period after a limit is formatting only;
    // that server-owned slot already supplies its final punctuation.
    const normalized = p.text.replace(/\s+/g, " ");
    const clauses: string[] = [];
    let sentence = "";
    const tokens = normalized.match(/\{\{[^}]+\}\}|[\s\S]/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/^\{\{r\d+\.limit\d+\}\}$/.test(token)) {
        if (sentence.trim())
          fail(
            "NARRATION_CLAIM",
            "clauses",
            "embedded_limit",
            clauses.length,
            sentence + token,
          );
        clauses.push(token);
        if (tokens[i + 1] === ".") i++;
        sentence = "";
      } else {
        sentence += token;
        if (/^[.!?]$/.test(token)) {
          clauses.push(sentence.trim());
          sentence = "";
        }
      }
    }
    // A final declarative clause may omit its period; it must still match a
    // complete proven sentence. Appending punctuation cannot authorize prose.
    if (sentence.trim()) clauses.push(sentence.trim() + ".");
    const local = new Set<string>();
    for (const [clauseIndex, clause] of clauses.entries()) {
      if (
        (clause.match(/\{\{[^}]+\}\}/g) ?? []).some(
          (t) => !Object.hasOwn(contract.slots, t),
        )
      )
        fail("NARRATION_VALUE", "claim", "unknown_slot", clauseIndex, clause);
      const proof = contract.sentences.find(
        (s) =>
          p.resultIds.includes(s.resultId) &&
          new RegExp(`^(?:${s.pattern})$`, "i").test(clause),
      );
      if (!proof) {
        if (
          contract.sentences.some((s) =>
            new RegExp(`^(?:${s.pattern})$`, "i").test(clause),
          )
        )
          fail(
            "NARRATION_REFERENCE",
            "reference",
            "sentence_result_mismatch",
            clauseIndex,
            clause,
          );
        const literal = clause.replace(/\{\{[^}]+\}\}/g, "");
        return fail(
          "NARRATION_CLAIM",
          "claim",
          /\d|[₦$€£]/.test(literal) ? "literal_value" : "unsupported_structure",
          clauseIndex,
          clause,
        );
      }
      local.add(proof.resultId);
      referenced.add(proof.resultId);
    }
    if (p.resultIds.some((id) => !local.has(id)))
      fail("NARRATION_REFERENCE", "reference", "unused_result");
    return clauses.join(" ").replace(/\{\{[^}]+\}\}/g, (t) => {
      used.add(t);
      return contract.slots[t];
    });
  });
  if (contract.required.some((t) => !used.has(t)))
    throw new NarrationError("NARRATION_LIMIT", {
      version: 1,
      stage: "limits",
      category: "missing_required_limit",
    });
  if (facts.some((f) => !referenced.has(f.resultId)))
    throw new NarrationError("NARRATION_LIMIT", {
      version: 1,
      stage: "reference",
      category: "unused_result",
    });
  return paragraphs;
}

export function factualPresentation(facts: Fact[]): FinancialPresentation {
  return {
    version: 1,
    narration: "factual_fallback",
    explanation: facts.map((f) => {
      const r = f.presentation;
      if (r.type === "calculate_spending")
        return `In the available records, expenses total ${r.metrics[0].value} and income totals ${r.metrics[1].value}. The ${r.metrics[2].label.toLowerCase()} is ${r.metrics[2].value}.`;
      if (r.type === "search_transactions")
        return r.records.length
          ? `${r.records.length} candidate records are shown. Choose a candidate to inspect its details.`
          : "No matching records were found in the available data.";
      if (r.type === "get_transaction")
        return "The source record is shown below. Its status does not confirm recipient bank credit.";
      return f.text;
    }),
    results: facts.map((f) => f.presentation),
  };
}
