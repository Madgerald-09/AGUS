import {
  ToolDataSchemas,
  toolResultSchema,
  type ToolCall,
  type ToolData,
  type ToolName,
  type ToolResult,
  type TransactionView,
} from "../financial-data/contracts";
import { AgentError, bytes, scrub } from "./protocol";

export type ReadResult = ToolResult<ToolData[ToolName]>;
export type Fact = { resultId: string; text: string; modelData: unknown };
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
};
export function money(kobo: number | null) {
  if (kobo === null) return "unavailable";
  if (!Number.isSafeInteger(kobo)) throw new AgentError("INVALID_RESULT");
  const value = BigInt(kobo),
    amount = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}₦${(amount / 100n).toLocaleString("en-NG")}.${(amount % 100n).toString().padStart(2, "0")}`;
}
/** Render literal provider labels as escaped data, never model-written narration. */
export const literalLabel = (label: string) =>
  JSON.stringify(scrub(label))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}[\]()#+.!|~])/g, "\\$1");
const view = (t: TransactionView) => ({
  id: t.id,
  untrustedCounterpartyLabel: t.counterparty.displayName
    ? scrub(t.counterparty.displayName).slice(0, 100)
    : null,
  accountId: t.accountId,
  revision: t.revision,
  amountKobo: t.amountKobo,
  direction: t.direction,
  status: t.status,
  reversalOfId: t.reversalOfId,
  occurredAt: t.occurredAt,
  bookedAt: t.bookedAt,
  dateBasis: t.dateBasis,
  source: t.source,
  simulated: t.simulated,
});
function transaction(t: TransactionView) {
  return `${t.id}${t.counterparty.displayName ? `; source counterparty label (untrusted literal) ${literalLabel(t.counterparty.displayName)}` : ""} on account ${t.accountId}: ${money(t.amountKobo)}, ${t.direction}, source status ${t.status}; date ${t.bookedAt ?? t.occurredAt ?? "unknown"} (${t.dateBasis}).${t.reversalOfId ? ` Returned funds linked to ${t.reversalOfId}; excluded from ordinary income.` : ""} A candidate record does not establish recipient bank credit.`;
}
function markers(provider: string, mode: string, simulated: boolean) {
  if (
    provider === "fixture"
      ? mode !== "fixture" || !simulated
      : mode === "fixture" || simulated
  )
    throw new AgentError("INVALID_RESULT");
}
/** Reject before model disclosure. Provider prose, descriptions, refs, URLs and artifact metadata are omitted. */
export function makeFact(
  call: ToolCall,
  raw: unknown,
): { fact: Fact; result: ReadResult } {
  if (bytes(raw) > 16 * 1024) throw new AgentError("RESULT_BUDGET");
  const result = toolResultSchema(call.name).parse(raw) as ReadResult;
  if (!result.error && result.meta.sources.length === 0)
    throw new AgentError("INVALID_RESULT");
  if (result.callId !== call.callId) throw new AgentError("INVALID_RESULT");
  const ids =
    "accountIds" in call.args ? call.args.accountIds : [call.args.accountId];
  if (result.meta.coverage?.missingAccountIds.some((id) => !ids.includes(id)))
    throw new AgentError("INVALID_RESULT");
  const sourceCheck = (
    s: { provider: string; mode: string },
    simulated: boolean,
  ) => {
    markers(s.provider, s.mode, simulated);
    if (
      !result.meta.sources.some(
        (x) => x.provider === s.provider && x.mode === s.mode,
      )
    )
      throw new AgentError("INVALID_RESULT");
  };
  for (const s of result.meta.sources)
    markers(s.provider, s.mode, s.provider === "fixture");
  if (
    result.meta.simulated !==
    result.meta.sources.some((s) => s.provider === "fixture")
  )
    throw new AgentError("INVALID_RESULT");
  const header = `[Source ${result.meta.resultId}: ${result.meta.sources.map((s) => `${s.provider}/${s.mode}`).join(", ") || "unavailable"}; as of ${result.meta.asOf}; ${result.meta.simulated ? "SIMULATED FICTIONAL DATA" : "source-reported data"}; coverage ${result.meta.coverage?.state ?? "not supplied"}${result.meta.truncated ? "; truncated" : ""}]`;
  const checkView = (t: TransactionView) => {
    if (!ids.includes(t.accountId)) throw new AgentError("INVALID_RESULT");
    sourceCheck(t.source, t.simulated);
    if (
      t.reversalOfId === t.id ||
      (t.reversalOfId !== null && t.direction !== "credit")
    )
      throw new AgentError("INVALID_RESULT");
  };
  let text: string;
  let modelData: unknown;
  if (result.error) {
    text = `Data unavailable (${result.error.code}). No financial conclusion can be drawn.`;
    modelData = { error: result.error.code };
  } else
    switch (call.name) {
      case "search_transactions": {
        const data = ToolDataSchemas.search_transactions.parse(result.data);
        if (canonical(data.appliedFilters) !== canonical(call.args))
          throw new AgentError("INVALID_RESULT");
        data.matches.forEach(checkView);
        if (
          new Set(data.matches.map((t) => `${t.accountId}:${t.id}`)).size !==
            data.matches.length ||
          data.matchCount < data.matches.length ||
          (data.selection === "none") !== (data.matchCount === 0) ||
          (data.selection === "single_candidate") !== (data.matchCount === 1)
        )
          throw new AgentError("INVALID_RESULT");
        text =
          data.selection === "none"
            ? "No matching records were found in the available data. Refine the account, date, name or amount; this is not proof that a payment never happened."
            : `${data.matchCount} candidate record(s) in the requested interval [${call.args.from}, ${call.args.toExclusive}), Africa/Lagos.\n${data.matches.map(transaction).join("\n")}${data.selection === "ambiguous" ? "\nWhich candidate do you mean? Please choose one or refine the search." : ""}${data.hasMore ? "\nMore candidates are available; this page is not the full history." : ""}`;
        modelData = {
          ...data,
          matches: data.matches.map(view),
          appliedFilters: {
            ...data.appliedFilters,
            query: "[search text withheld]",
          },
        };
        break;
      }
      case "get_transaction": {
        const data = ToolDataSchemas.get_transaction.parse(result.data);
        checkView(data);
        if (data.id !== call.args.transactionId)
          throw new AgentError("INVALID_RESULT");
        text = transaction(data);
        modelData = view(data);
        break;
      }
      case "calculate_spending": {
        const data = ToolDataSchemas.calculate_spending.parse(result.data);
        if (
          canonical(data.appliedFilters) !== canonical(call.args) ||
          data.netKobo !== data.incomeKobo - data.expenseKobo ||
          !Number.isSafeInteger(data.netKobo) ||
          result.meta.truncated ||
          data.coverage.state === "unknown"
        )
          throw new AgentError("INVALID_RESULT");
        const filters = data.appliedFilters;
        text = `${data.coverage.state === "complete" && result.outcome === "ok" ? "Source records" : "Available records only"} for accounts ${filters.accountIds.join(", ")}, interval [${filters.from}, ${filters.toExclusive}), Africa/Lagos; direction ${filters.direction ?? "both"}, category ${filters.category ? literalLabel(filters.category) : "all"}, statuses posted${filters.amountKobo ? `, inclusive amount range ${money(filters.amountKobo.min)} to ${money(filters.amountKobo.max)}` : ""}. Expenses ${money(data.expenseKobo)}; income ${money(data.incomeKobo)}; ${filters.direction || filters.category || filters.amountKobo ? "filtered difference" : "net"} ${money(data.netKobo)}. Included ${data.includedCount} records. Excluded pending ${data.excluded.pending}, failed ${data.excluded.failed}, reversed ${data.excluded.reversed}, unknown ${data.excluded.unknown}, reversal credits ${data.excluded.reversal}, undated ${data.excluded.undated}. Calculation ${data.calculationId}.`;
        if (data.groups.length)
          text +=
            "\nSource groups (labels are literal data):\n" +
            data.groups
              .map(
                (g) =>
                  `${literalLabel(g.key)}: expenses ${money(g.expenseKobo)}, income ${money(g.incomeKobo)}, difference ${money(g.netKobo)}, ${g.includedCount} records.`,
              )
              .join("\n");
        // Group keys/category strings originate at the provider; do not promote them to instructions.
        modelData = {
          ...data,
          groups: data.groups.map((g) => ({
            ...g,
            key: "[group label withheld]",
          })),
          appliedFilters: {
            ...filters,
            category: filters.category ? "[requested category]" : undefined,
          },
        };
        break;
      }
      case "find_payment_evidence": {
        const data = ToolDataSchemas.find_payment_evidence.parse(result.data);
        for (const e of data.evidence) {
          if (e.transactionId !== call.args.transactionId)
            throw new AgentError("INVALID_RESULT");
          sourceCheck(e, e.simulated);
        }
        text = data.evidence.length
          ? data.evidence
              .map(
                (e) =>
                  `Evidence ${e.id}: ${e.kind}, ${e.provider}/${e.mode}, observed ${e.observedAt}.${e.simulated ? " Fictional synthetic evidence, not a bank receipt." : " Source record only."} This does not establish recipient bank credit; provider narrative and artifacts are not verified here.`,
              )
              .join("\n")
          : "No evidence is available for this transaction. I cannot supply a receipt or confirm recipient bank credit.";
        modelData = {
          evidence: data.evidence.map((e) => ({
            id: e.id,
            transactionId: e.transactionId,
            kind: e.kind,
            provider: e.provider,
            mode: e.mode,
            observedAt: e.observedAt,
            simulated: e.simulated,
          })),
        };
        break;
      }
      case "get_account_summary": {
        const data = ToolDataSchemas.get_account_summary.parse(result.data);
        if (
          new Set(data.accounts.map((a) => a.accountId)).size !==
            data.accounts.length ||
          data.accounts.length !== ids.length
        )
          throw new AgentError("INVALID_RESULT");
        for (const a of data.accounts) {
          if (
            !ids.includes(a.accountId) ||
            a.source.provider === "paystack_projection"
          )
            throw new AgentError("INVALID_RESULT");
          sourceCheck(a.source, a.simulated);
        }
        text = data.accounts
          .map(
            (a) =>
              `Account ${a.accountId}: available balance ${money(a.availableKobo)}, current balance ${money(a.currentKobo)}; observed ${a.asOf ?? "unknown"}, last synced ${a.lastSyncedAt ?? "unknown"}${a.unavailableReason ? `; ${a.unavailableReason}` : ""}. Unknown balances are not zero.`,
          )
          .join("\n");
        modelData = data;
        break;
      }
    }
  return {
    result,
    fact: {
      resultId: result.meta.resultId,
      text: `${text}\n${header}`,
      modelData: {
        outcome: result.outcome,
        data: modelData,
        meta: { ...result.meta, warnings: undefined, nextCursor: undefined },
      },
    },
  };
}
