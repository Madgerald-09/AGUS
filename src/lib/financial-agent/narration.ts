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

/** Evidence-constrained prose authoring. Whole-sentence grammar checks prove
 * supported propositions independently of a model reviewer. Values and labels
 * are inserted only after validation. Unrecognized claims fail closed. */
export function narrationContract(facts: Fact[]) {
  const slots: Record<string, string> = {};
  const sentences: { pattern: string; resultId: string }[] = [];
  const required: string[] = [];
  const allow = (resultId: string, pattern: string) =>
    sentences.push({ resultId, pattern });
  const literal = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [i, fact] of facts.entries()) {
    const r = fact.presentation,
      key = `r${i}`;
    const token = (name: string, value: string) => {
      const t = `{{${key}.${name}}}`;
      slots[t] = value;
      return literal(t);
    };
    const scope = token("scope", r.scope);
    allow(r.resultId, `(?:The figures cover|These records cover) ${scope}\\.`);
    if (r.type === "calculate_spending") {
      const expense = token("expenses", r.metrics[0].value),
        income = token("income", r.metrics[1].value),
        diff = token("difference", r.metrics[2].value);
      allow(
        r.resultId,
        `(?:In the available records, )?(?:expenses|Expenses) (?:total|are|come to) ${expense}(?:,? (?:and|while) income (?:totals|is|comes to) ${income})?\\.`,
      );
      allow(
        r.resultId,
        `(?:The records show|These records show) expenses of ${expense} and income of ${income}\\.`,
      );
      allow(r.resultId, `Income (?:totals|is|comes to) ${income}\\.`);
      allow(
        r.resultId,
        `The ${r.metrics[2].label.toLowerCase()} (?:is|comes to) ${diff}\\.`,
      );
      const negative = r.metrics[2].value.startsWith("-"),
        zero = r.metrics[2].value === "₦0.00";
      allow(
        r.resultId,
        zero
          ? "Income and expenses are equal in these records\\."
          : negative
            ? "Expenses exceeded income in these records\\."
            : "Income exceeded expenses in these records\\.",
      );
    }
    if (r.type === "search_transactions" || r.type === "get_transaction") {
      if (r.records.length)
        allow(
          r.resultId,
          `(?:I found|The available data contains) ${token("count", String(r.records.length))} (?:matching|candidate) records?\\.`,
        );
      else
        allow(
          r.resultId,
          "No matching records were found in the available data\\.",
        );
      r.records.forEach((record, n) => {
        const name = token(`name${n}`, record.name),
          amount = token(`amount${n}`, record.amount),
          direction = token(`direction${n}`, record.direction),
          status = token(`status${n}`, record.status);
        allow(r.resultId, `${name} has a ${direction} record of ${amount}\\.`);
        allow(
          r.resultId,
          `The source lists the record for ${name} as ${status}\\.`,
        );
      });
      if (r.records.length > 1)
        allow(
          r.resultId,
          "Please choose a candidate to inspect its details\\.",
        );
    }
    r.limits.forEach((limit, n) => {
      const t = `{{${key}.limit${n}}}`;
      required.push(t);
      slots[t] = /[.!?]$/.test(limit) ? limit : `${limit}.`;
      allow(r.resultId, literal(t));
    });
    if (r.type === "find_payment_evidence")
      allow(
        r.resultId,
        "The available evidence cannot confirm recipient bank credit\\.",
      );
  }
  return { slots, sentences, required };
}

export function acceptNarration(raw: unknown, facts: Fact[]): string[] {
  const answer = NarrationSchema.parse(raw),
    contract = narrationContract(facts);
  const allowedIds = new Set(facts.map((f) => f.resultId)),
    used = new Set<string>(),
    referenced = new Set<string>();
  const paragraphs = answer.paragraphs.map((p) => {
    if (
      new Set(p.resultIds).size !== p.resultIds.length ||
      p.resultIds.some((id) => !allowedIds.has(id))
    )
      throw new AgentError("NARRATION_REFERENCE");
    // Split before insertion: decimal points and untrusted names remain data.
    const clauses: string[] = [];
    let sentence = "";
    for (const token of p.text.match(/\{\{[^}]+\}\}|[\s\S]/g) ?? []) {
      if (/^\{\{r\d+\.limit\d+\}\}$/.test(token) && !sentence.trim()) {
        clauses.push(token);
        sentence = "";
      } else {
        sentence += token;
        if (/^[.!?]$/.test(token)) {
          clauses.push(sentence.trim());
          sentence = "";
        }
      }
    }
    if (sentence.trim()) throw new AgentError("NARRATION_CLAIM");
    if (clauses.map((s) => s.trim()).join(" ") !== p.text.replace(/\s+/g, " "))
      throw new AgentError("NARRATION_CLAIM");
    const local = new Set<string>();
    for (const clause of clauses) {
      const proof = contract.sentences.find(
        (s) =>
          p.resultIds.includes(s.resultId) &&
          new RegExp(`^${s.pattern}$`).test(clause.trim()),
      );
      if (!proof) throw new AgentError("NARRATION_CLAIM");
      local.add(proof.resultId);
      referenced.add(proof.resultId);
    }
    if (p.resultIds.some((id) => !local.has(id)))
      throw new AgentError("NARRATION_REFERENCE");
    return p.text.replace(/\{\{[^}]+\}\}/g, (t) => {
      if (!(t in contract.slots)) throw new AgentError("NARRATION_VALUE");
      used.add(t);
      return contract.slots[t];
    });
  });
  if (
    contract.required.some((t) => !used.has(t)) ||
    facts.some((f) => !referenced.has(f.resultId))
  )
    throw new AgentError("NARRATION_LIMIT");
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
