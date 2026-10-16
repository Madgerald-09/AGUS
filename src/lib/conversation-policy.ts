import type { Proposed } from "./intelligence";
import type { Message, Mode, Status } from "./domain";

// No model-authored prose crosses the narration boundary. Even ordinary
// conversational intents are untrusted: an intent label cannot certify prose.
export function conversationalIntent(request: string) {
  if (
    /^\s*(?:thanks?|thank you)(?: so much| a lot)?(?:[ ,]+agus)?[.!?👋\s]*$/iu.test(
      request,
    )
  )
    return "thanks";
  if (
    /^\s*(?:hey|hi|hello|good morning|good afternoon|good evening)(?:[ ,!]+agus)?[.!?👋\s]*$/iu.test(
      request,
    )
  )
    return "greeting";
  if (
    /^(?:agus[, ]+)?(?:what can you (?:do(?: for me)?|help.*)|what do you do|how can you help.*|who are you|(?:what are )?your capabilities)[.!?\s]*$/i.test(
      request.trim(),
    )
  )
    return "capabilities";
  if (
    /^(?:how are you|how.s it going|what.s up)(?:[ ,]+agus)?[.!?\s]*$/i.test(
      request.trim(),
    )
  )
    return "smalltalk";
  return null;
}
export function composeConversation(request: string) {
  const intent = conversationalIntent(request);
  if (intent === "thanks")
    return "You’re welcome! What would you like to take care of next?";
  if (intent === "greeting")
    return "Hey! 👋 I’m Agus. Want to check your spending, prepare a payment, or follow up on a transfer?";
  if (intent === "capabilities")
    return "I can help you understand spending from the sample ledger, prepare payment drafts for one or several recipients, and follow up on saved transfers. You can correct a draft in chat or edit its card, then verify the recipient and review it before approving. Submission is a separate step. What would you like to start with?";
  if (intent === "smalltalk")
    return "I’m here and ready to help. What would you like to take care of today?";
  if (
    /balance|did.*(?:go through|receiv)|has it|went through|confirm.*(?:payment|transfer)|successful|settled/i.test(
      request,
    )
  )
    return "I can check saved payment records, but I can’t confirm a transfer or your bank balance from chat alone. Open the payment card for its saved status; use Check provider if the outcome is unresolved.";
  return "Tell me a little more. Are you looking at spending, preparing a payment, or following up on a saved transfer?";
}

export function describePaymentStatus(status: Status, mode: Mode) {
  const labels: Record<Status, string> = {
    draft: "Draft · not submitted",
    awaiting_beneficiary_verification: "Draft · needs recipient verification",
    awaiting_user_approval: "Verified draft · needs your approval",
    approved: "Approved · not submitted",
    submitted: "Submitted · outcome unresolved",
    processing: "Processing · outcome unresolved",
    successful: "successful",
    failed: "failed",
    reversed: "reversed",
    unknown: "Unknown · needs a provider check",
    awaiting_otp: "Awaiting provider OTP · not completed",
  };
  const environment =
    mode === "fixture"
      ? "Simulation"
      : mode === "test"
        ? "Paystack test"
        : "Live";
  return `${environment} · ${labels[status] ?? "Status unavailable"}`;
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
