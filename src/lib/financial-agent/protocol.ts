import { z } from "zod";
import { ToolCallSchema, IdSchema } from "../financial-data/contracts";

export const RouteSchema = z.strictObject({
  route: z.enum([
    "general",
    "financial_education",
    "financial_reasoning",
    "product",
    "financial_read",
    "payment_draft",
    "payment_action",
  ]),
});
export const ProductTopicSchema = z.enum([
  "overview",
  "data",
  "payments",
  "privacy",
  "unknown",
]);
export const ClarificationSchema = z.enum([
  "account",
  "date",
  "amount",
  "selection",
  "scope",
]);
export const DecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clarify"), reason: ClarificationSchema }),
  z.strictObject({ kind: z.literal("call_tool"), call: ToolCallSchema }),
  z.strictObject({
    kind: z.literal("respond"),
    resultIds: z.array(IdSchema).min(1).max(5),
  }),
]);
export type Decision = z.infer<typeof DecisionSchema>;
export const GeneralSchema = z.strictObject({
  text: z.string().trim().min(1).max(1800),
});
const figure = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
export const CalculationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("savings_goal"),
    monthlySavingsNaira: figure,
    targetNaira: figure,
    startingNaira: figure,
  }),
  z.strictObject({
    kind: z.literal("savings_total"),
    incomeNaira: figure,
    savingsPercent: figure,
    months: z.number().int().min(1).max(1200),
  }),
  z.strictObject({
    kind: z.literal("simple_interest"),
    principalNaira: figure,
    annualRatePercent: figure,
    months: z.number().int().min(1).max(1200),
  }),
]);
export const ReasoningSchema = GeneralSchema.extend({
  calculation: CalculationSchema.nullable().optional(),
});
export const ReviewSchema = z.strictObject({
  safeGeneralConversation: z.boolean(),
});
export type ModelTask =
  | "classify"
  | "general"
  | "reason"
  | "review_general"
  | "product"
  | "plan"
  | "narrate";
/** One request means one HTTP attempt. Implementations must honor signal; the executor also races it. */
export interface AgentModel {
  readonly provider: string;
  readonly model: string;
  generate(
    task: ModelTask,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export const QUESTIONS: Record<z.infer<typeof ClarificationSchema>, string> = {
  account:
    "I need transaction history to answer that. Choose an authorized demo account to continue.",
  date: "Which exact dates do you mean? For example, tell me the month or the first and last day to check. I use Lagos time.",
  amount:
    "What exact amount or minimum and maximum should I search for? I need your confirmed tolerance for an approximate amount.",
  selection:
    "Which transaction do you mean? Please choose a candidate or refine the search.",
  scope: "Please specify the account and date range you want me to check.",
};
export const UNAVAILABLE =
  "I couldn’t complete this request with verified data. Please try again or narrow the request.";

export class AgentError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export const bytes = (v: unknown) =>
  Buffer.byteLength(JSON.stringify(v), "utf8");
/** Scrub before model disclosure and persistence, including user-supplied credentials/URLs. */
export function scrub(text: string) {
  return text
    .replace(/https?:\/\/\S+/gi, "[URL withheld]")
    .replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]+/g, "[credential withheld]")
    .replace(
      /\b(?:password|token|secret|api[_ -]?key|otp)\s*[:=]\s*\S+/gi,
      "[credential withheld]",
    )
    .replace(/\b\d(?:[ -]?\d){7,}\b/g, "[long number withheld]")
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? " "
        : character,
    )
    .join("");
}
/** Conservative backstop; semantic routing/review are additional gates, never a grounding proof. */
export function financialLanguage(text: string) {
  return /\b(?:account|balance|bank|payment|paid|transfer|receipt|spen[dt]|income|expense|transaction|credit|debit|salary|consent|naira|kobo|NGN|AGUS|otp|beneficiar|funds|money|budget|invest|loan|tax|financial|rent|refund)\w*\b|[₦$€£]/i.test(
    text,
  );
}
function historicalPaymentQuestion(text: string) {
  return (
    /^(?:how much did I pay|did I (?:pay|send)|have I (?:paid|sent))\b[^;!\n&]*[?.]?$/i.test(
      text.trim(),
    ) &&
    !/\b(?:and|then|but|also|or|otherwise|if|please|now|approve|submit|execute|retry|send|pay|make|prepare|draft|initiate|start|schedule|process|wire|remit|move|confirm|complete|proceed|repeat|rerun|otp)\b/i.test(
      text.replace(
        /^(?:how much did I pay|did I (?:pay|send)|have I (?:paid|sent))\b/i,
        "",
      ),
    )
  );
}
export function paymentIntent(
  text: string,
): "payment_draft" | "payment_action" | null {
  if (historicalPaymentQuestion(text)) return null;
  const subject =
    /\b(?:payment|transfer|transaction|bank|funds|money|naira|NGN|otp)\b|₦/i.test(
      text,
    );
  if (
    (subject &&
      /\b(?:approv\w*|authori[sz]\w*|submit|execute|retry|otp)\b/i.test(
        text,
      )) ||
    /^(?:please\s+)?(?:approve|submit|execute|retry)\s+(?:it|that)(?:\s+now)?[.!]?$/i.test(
      text,
    )
  )
    return "payment_action";
  if (
    (subject && /\b(?:send|pay|prepare|draft)\b/i.test(text)) ||
    /\b(?:send|pay)\s+[₦\d]/i.test(text)
  )
    return "payment_draft";
  return null;
}
/** Narrow correction for payment-route false positives, never authorization.
 * Unknown clauses and even negated action words deliberately fail closed.
 */
export function historicalReadIntent(text: string): boolean {
  if (historicalPaymentQuestion(text)) return true;
  if (
    paymentIntent(text) ||
    /\b(?:initiat\w*|start\w*|creat\w*|schedul\w*|process\w*|execut\w*|submi\w*|retry\w*|retried|retries|approv\w*|authori[sz]\w*|send\w*|pay|paying|draft\w*|prepar\w*|wir\w*|remit\w*|transferr\w*|mov\w*|confirm\w*|complet\w*|proceed\w*|continu\w*|handl\w*|resolv\w*|repeat\w*|rerun\w*|do|make|otp)\b|\b(?:go ahead|take care|set up)\b/i.test(
      text,
    ) ||
    !/\b(?:transactions?|payments?|transfers?|receipts?|exact\s+reference)\b/i.test(
      text,
    )
  )
    return false;

  // Each instruction must be an explicit read. Allow only a small noun-only
  // continuation for "retrieve transaction details and payment evidence".
  const clauses = text
    .split(
      /[,.!?;:\n&]+|\b(?:and(?:\s+then)?|then|but|also|or|otherwise|afterwards|before|after|once|if|when|so)\b/i,
    )
    .map((clause) => clause.replace(/^[\s,]+|[\s,]+$/g, ""))
    .filter(Boolean);
  const read =
    /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:search|find|look up|list|show|retrieve|fetch|explain)\b/i;
  return (
    clauses.length > 0 &&
    read.test(clauses[0]) &&
    clauses.every(
      (clause) =>
        read.test(clause) ||
        /^(?:(?:the|its|their)\s+)?(?:payment evidence|evidence|receipts?|transaction details)(?:\s+for\s+.+)?$/i.test(
          clause,
        ),
    )
  );
}
export function actionClaim(text: string) {
  return /\bI(?:'ve| have)?\s+(?:approved|submitted|executed|sent|paid|verified)\b/i.test(
    text,
  );
}

/** Lexical backstop, not a factuality proof: semantic review is still required.
 * Generic pronouns and example amounts do not establish personal financial facts.
 */
export function personalFinancialLanguage(text: string) {
  const prose = text.replace(/\s+/g, " ").replace(/’/g, "'");
  return (
    /\bAGUS\b|\b(?:recommend|should|guarantee|guaranteed|submitted|executed|verified|approved|credited|debited|successful)\w*\b|\b(?:otp|password|token|secret|pin|api[ _-]?key)\b|\b(?:payment|transfer|transaction)\b.{0,40}\b(?:went through|reached|settled|complete|paid|sent|succeeded)\w*\b/i.test(
      prose,
    ) ||
    // Ownership plus a financial assertion, rather than "your purchasing power"
    // or "plan your spending". Do not exempt a claim labelled "for example".
    /\b(?:my|our|your|his|her|their|\w+'s)\s+(?:\w+\s+){0,3}(?:balance|accounts?|bank|payments?|transfers?|transactions?|salary|income|expenses?|spending|savings|debt|portfolio|returns?|credit score)\b(?:\s*[:=]|\s+(?:\w+\s+){0,3}(?:is|are|was|were|has|have|had|equals?|totals?|stands?|shows?|contains?|increased|decreased|rose|fell)\b)/i.test(
      prose,
    ) ||
    /(?<!\bif )\b(?:I|we|you|he|she|they)(?:'ve|'re|'m|'s)?\s+(?:(?:have|has|had)\s+)?(?:earned?|spen[dt]|owe|own|hold|received?|paid|sent|approved|submitted|executed|verified|completed|processed|initiated|scheduled|authori[sz]ed)\b/i.test(
      prose,
    ) ||
    /(?<!\bif )\b(?:I|we|you)\s+have\s+(?:[₦$€£]|\d|NGN\b|an?\s+(?:account|balance|loan)\b)/i.test(
      prose,
    ) ||
    // Concrete payment instructions never belong in the education channel.
    /\b(?:send|pay|transfer|wire|remit|move|deposit|withdraw)\s+(?:(?:the|your|our|my|some|all)\s+)?(?:money\b|funds\b|cash\b|[₦$€£]|\d|NGN\b)|\b(?:click|tap|press)\s+(?:the\s+)?(?:send|pay|transfer|submit|approve)\b/i.test(
      prose,
    )
  );
}
