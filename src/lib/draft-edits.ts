import type { Bank } from "./paystack";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function aliases(bank: Bank) {
  const full = normalize(bank.name);
  const short = full
    .replace(
      /\b(?:bank|microfinance|limited|ltd|plc|nigeria|digital|services|payment|payments|mfb|of|for|the)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return [
    ...new Set([
      full,
      short,
      ...(/\bopay\b/.test(full) ? ["opay"] : []),
      ...(/guaranty trust/.test(full) ? ["gtb", "gtbank"] : []),
      ...(/united bank for africa/.test(full) ? ["uba"] : []),
    ]),
  ].filter(Boolean);
}
// Aliases identify names only. Every returned code comes from this provider list.
export function mentionedBanks(text: string, banks: Bank[]) {
  const words = ` ${normalize(text)} `;
  return banks.filter((b) => aliases(b).some((a) => words.includes(` ${a} `)));
}
export function resolveBankName(query: string, banks: Bank[]) {
  const exact = banks.filter((b) => aliases(b).includes(normalize(query)));
  return exact.length ? exact : mentionedBanks(query, banks);
}
export interface DraftEdit {
  bankQuery?: string;
  bankCode?: string;
  accountNumber?: string;
  amountNaira?: string;
  name?: string;
  recipientIndex?: number;
  recipientName?: string;
  missing?: string;
}
export function parseDraftEdit(request: string): DraftEdit | null {
  const text = request.trim().replace(/[.!?]+$/, "");
  const ordinal = text.match(
    /\b(?:the )?(first|second|third|fourth|fifth|[1-9]|10)(?:st|nd|rd|th)? recipient\b/i,
  );
  const index = ordinal
    ? ["first", "second", "third", "fourth", "fifth"].indexOf(
        ordinal[1].toLowerCase(),
      )
    : -1;
  const target = ordinal
    ? { recipientIndex: index >= 0 ? index : Number(ordinal[1]) - 1 }
    : {};
  const namedTarget = text
    .match(
      /^(?:please\s+)?(?:change|switch|set)(?:\s+the)?\s+bank\s+for\s+(.+?)\s+to\s+/i,
    )?.[1]
    ?.trim();
  const namedSelection = !ordinal
    ? text.match(/^I meant (?:recipient )?(.+)$/i)?.[1]?.trim()
    : undefined;
  const edit: DraftEdit = {
    ...target,
    ...(namedTarget && !ordinal ? { recipientName: namedTarget } : {}),
    ...(namedSelection
      ? { recipientName: namedSelection, missing: "change" }
      : {}),
  };
  const bank =
    text.match(
      /^(?:please\s+)?(?:change|switch|set)(?:\s+the)?\s+bank(?:\s+for\s+.+?)?\s+to\s+(.+)$/i,
    ) ??
    text.match(/^(?:please\s+)?use\s+(.+?)(?:\s+bank)?\s+instead$/i) ??
    text.match(/^(.+?)\s+bank(?:\s+(?:naw|now|instead|please))?$/i);
  if (bank) edit.bankQuery = bank[1].trim();
  const code = text.match(/\bbank(?: code)?\s*[:=]\s*(\d{3,6})\b/i)?.[1];
  if (code) edit.bankCode = code;
  const account = text.match(
    /\baccount(?: number)?\s*(?:(?:to|is)\s*|[:=]\s*)?(\d{10})\b/i,
  )?.[1];
  if (account) edit.accountNumber = account;
  const amount =
    text.match(
      /^(?:make it|change (?:the )?amount to|amount\s*[:=])\s*(?:₦|NGN\s*)?(\d+(?:\.\d{1,2})?)(?:\s*naira)?$/i,
    ) ?? text.match(/^(?:₦|NGN\s*)(\d+(?:\.\d{1,2})?)$/i);
  if (amount) edit.amountNaira = amount[1];
  // Semicolon-separated fields are also used by the existing explicit parser.
  const explicitAmount = text.match(
    /\bamount\s*[:=]\s*(\d+(?:\.\d{1,2})?)(?=\s*(?:;|$))/i,
  )?.[1];
  if (explicitAmount) edit.amountNaira = explicitAmount;
  if (
    !amount &&
    !explicitAmount &&
    /^(?:make it|change (?:the )?amount to|amount\s*[:=])/i.test(text)
  )
    edit.missing = "amount (for example, ₦700)";
  const name = text
    .match(/\b(?:name|recipient label)\s*[:=]\s*([^;,\n]+)/i)?.[1]
    ?.trim();
  if (name) edit.name = name;
  if (
    !account &&
    /^(?:please\s+)?change (?:the )?account(?: number)?\b/i.test(text)
  )
    edit.missing = "10-digit account number";
  if (/^(?:please\s+)?change (?:the )?bank$/i.test(text)) edit.missing = "bank";
  if (ordinal && !bank && !code && !account && !amount && !name)
    edit.missing = "change";
  // Do not reinterpret a new payment instruction as an edit.
  if (
    /^(?:(?:help me|please|can you|could you|I want to)\s+)*(?:prepare|send|pay)\b/i.test(
      text,
    )
  )
    return null;
  return Object.keys(edit).some((key) => key !== "recipientName") ? edit : null;
}
