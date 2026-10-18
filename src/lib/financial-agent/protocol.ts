import { z } from "zod";
import { ToolCallSchema, IdSchema } from "../financial-data/contracts";

export const RouteSchema = z.strictObject({
  route: z.enum([
    "general",
    "financial_education",
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
export const ReviewSchema = z.strictObject({
  safeGeneralConversation: z.boolean(),
});
export type ModelTask =
  "classify" | "general" | "review_general" | "product" | "plan";
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
  account: "Which account should I use? Please choose an authorized account.",
  date: "Which exact dates do you mean? I use Africa/Lagos time and an exclusive end date.",
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
export function paymentIntent(
  text: string,
): "payment_draft" | "payment_action" | null {
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
export function actionClaim(text: string) {
  return /\bI(?:'ve| have)?\s+(?:approved|submitted|executed|sent|paid|verified)\b/i.test(
    text,
  );
}

/** Education can discuss money, but cannot disclose personal facts or recommendations. */
export function personalFinancialLanguage(text: string) {
  return /\b(?:my|mine|our|ours|your|yours|you|I|we|me|AGUS)\b|\b(?:recommend|should|guarantee|guaranteed|submitted|executed|verified|approved|credited|debited|successful)\w*\b|[₦$€£]|\b(?:otp|password|token|secret)\b|\b(?:payment|transfer|transaction)\b.{0,40}\b(?:went through|reached|settled|complete|paid)\w*\b/i.test(
    text,
  );
}

/** Teaching requests addressed to the assistant need no personal records. */
export function personalFinancialRequest(text: string) {
  return /\b(?:my|mine|our|ours)\b|\b(?:I|we)\s+(?:have|had|earn|earned|spend|spent|paid|pay|owe|own)\b|\b(?:should|recommend|advise)\b|\b(?:this|that|those|smaller|larger|first|second)\b.{0,30}\b(?:payment|transaction|transfer|account|one)\b/i.test(
    text,
  );
}
