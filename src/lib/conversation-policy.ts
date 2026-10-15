import type { Proposed } from "./intelligence";

// Free model prose is reserved for ordinary conversation. Financial responses
// are composed by the server. Fail closed on numbers, money, identities, result
// language, links and instructions to authorize. This is defense in depth, not
// a source of financial truth or permission to run a tool.
export function safeConversation(text: string) {
  return (
    !/[\p{N}\p{Sc}]|https?:|www\.|@|\b(?:balance|account|bank|verified|verification|successful|success|approved|approval|submitted|completed|executed|transferred|sent|paid|debited|credited|processing|reversed|failed|fee|fees|income|expense|expenses|spent|spending|budget|saved|naira|kobo|dollars?|pounds?|euros?|received|recipient|beneficiary|funded|settled|done|password|otp|authorize|authorise|confirm|confirmation)\b/iu.test(
      text,
    ) &&
    (!/\b(?:pay|payment|payments|send|transfer|money|funds)\b/i.test(text) ||
      (/\?$/.test(text.trim()) &&
        !/\b(?:I|we|your|have|has|will|did)\b/i.test(text)))
  );
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
