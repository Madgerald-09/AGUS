import type { Proposed } from "./intelligence";
import type { Message } from "./domain";

// No model-authored prose crosses the narration boundary. Even ordinary
// conversational intents are untrusted: an intent label cannot certify prose.
export function composeConversation(request: string) {
  if (/^\s*(?:thanks?|thank you)[.!\s]*$/i.test(request))
    return "You’re welcome. What would you like to take care of next?";
  if (/^\s*(?:hey|hi|hello)[.!\s]*$/i.test(request))
    return "Hey! What would you like help with today?";
  if (/what can you|how can you help|your capabilities/i.test(request))
    return "Let’s take it one step at a time.";
  return "I can help you prepare a draft or look up saved payment records. I can’t confirm an outcome from conversation alone. Open the payment card for its saved status and use Check provider for an unresolved transfer. I don’t have access to your bank balance.";
}

// Only server composition introduced by this repair may be presented as an
// assistant answer. Older free prose is retained in storage, but quarantined
// from both display and inference. Preserve draft links and editable fields.
export function presentMessage(message: Message): Message {
  if (message.role !== "assistant" || message.compositionVersion === 1)
    return message;
  return {
    ...message,
    content:
      "This earlier assistant answer is unavailable because its financial claims cannot be trusted. Review the payment card for saved status, or ask for saved payment records or fictional spending insights.",
    proposals: message.proposals?.map((p) => ({
      ...p,
      warnings: ["Unverified instructions. Review every field before saving."],
    })),
  };
}

const bankNames: Record<string, RegExp> = {
  "035": /\bwema\b/i,
  "044": /\baccess\b/i,
  "058": /\b(?:gtbank|gtb|guaranty trust)\b/i,
  "033": /\buba\b/i,
};
export function groundProposal(
  p: Proposed,
  request: string,
  previous?: Proposed,
): Proposed {
  const contains = (value: string) =>
    request.toLowerCase().includes(value.toLowerCase());
  const bankCodes = [
    ...request.matchAll(/\bbank(?: code)?\s*[:=]?\s*(\d{3,6})\b/gi),
  ].map((m) => m[1]);
  const amounts = [
    ...request.matchAll(
      /(?:₦|NGN\s*|\bamount\s*[:=]?\s*)(\d+(?:\.\d{1,2})?)(?![\d.])|\b(\d+(?:\.\d{1,2})?)\s+(?:to|for|naira)\b/gi,
    ),
  ].map((m) => m[1] ?? m[2]);
  const missingAccount =
    /(?:haven.t|have not|not|no|missing|without|don.t|do not).{0,35}account|account.{0,25}(?:missing|unknown|not provided)/i.test(
      request,
    );
  const missingAmount =
    /(?:no|missing|without|not provided).{0,20}amount/i.test(request);
  const grounded = {
    ...p,
    name:
      p.name && (contains(p.name) || p.name === previous?.name) ? p.name : "",
    bankCode:
      p.bankCode &&
      (bankCodes.includes(p.bankCode) ||
        bankNames[p.bankCode]?.test(request) ||
        p.bankCode === previous?.bankCode)
        ? p.bankCode
        : null,
    accountNumber:
      !missingAccount &&
      p.accountNumber &&
      (contains(p.accountNumber) || p.accountNumber === previous?.accountNumber)
        ? p.accountNumber
        : null,
    amountNaira:
      !missingAmount &&
      p.amountNaira &&
      (amounts.some((n) => Number(n) === Number(p.amountNaira)) ||
        p.amountNaira === previous?.amountNaira)
        ? p.amountNaira
        : null,
    reason: contains(p.reason) ? p.reason : "Payment",
    warnings: [
      "Unverified instructions. Missing details stay empty; review every field before saving.",
    ],
  };
  return grounded;
}
