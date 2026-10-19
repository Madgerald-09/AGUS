import { z } from "zod";
import { performance } from "node:perf_hooks";
import {
  PermissionContextSchema,
  IdSchema,
  InstantSchema,
  ToolCallSchema,
  ReadFilterSchema,
  ToolArgsSchemas,
  type PermissionContext,
  type ReadToolDispatcher,
  type Scope,
  type ToolCall,
} from "../financial-data/contracts";
import { type AccessResolver, type AccessSnapshot } from "./access";
import {
  ContextKeySchema,
  ContextSchema,
  boundedMessages,
  type ContextStore,
  type ConversationContext,
} from "./context";
import { makeFact, canonical, type Fact, type ReadResult } from "./facts";
import { PRODUCT_KNOWLEDGE, productAnswer } from "./knowledge";
import { resolveDateWindow } from "./date-window";
import {
  acceptNarration,
  factualPresentation,
  narrationContract,
} from "./narration";
import type { FinancialPresentation } from "./presentation";
import {
  RouteSchema,
  DecisionSchema,
  GeneralSchema,
  ReviewSchema,
  ProductTopicSchema,
  QUESTIONS,
  UNAVAILABLE,
  AgentError,
  bytes,
  financialLanguage,
  personalFinancialLanguage,
  personalFinancialRequest,
  actionClaim,
  paymentIntent,
  historicalReadIntent,
  scrub,
  type AgentModel,
  type ModelTask,
} from "./protocol";

export const LIMITS = Object.freeze({
  tools: 5,
  models: 6,
  turnMs: 60000,
  modelMs: 20000,
  toolMs: 10000,
  resultBytes: 16384,
  turnBytes: 49152,
});
export type AgentReply = {
  kind:
    | "general"
    | "product"
    | "financial"
    | "clarify"
    | "handoff"
    | "unavailable"
    | "conflict";
  text: string;
  citations: string[];
  presentation?: FinancialPresentation;
  handoff?: { kind: "existing_payment_draft" };
  evidence: {
    modelCalls: number;
    toolCalls: number;
    resultBytes: number;
    code?: string;
  };
};
export type AgentOptions = {
  model: AgentModel;
  tools: ReadToolDispatcher;
  access: AccessResolver;
  store: ContextStore;
  clock?: () => string;
  monotonic?: () => number;
};
const inputSchema = z.strictObject({
  ctx: PermissionContextSchema,
  conversationId: IdSchema,
  text: z.string().trim().min(1).max(4000),
  // Server selection only; Gerald must derive this from the authenticated session.
  accountIds: z
    .array(IdSchema)
    .max(5)
    .refine((v) => new Set(v).size === v.length),
});
export function createFinancialAgent(options: AgentOptions) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const monotonic = options.monotonic ?? (() => performance.now());
  return {
    async turn(untrusted: z.infer<typeof inputSchema>): Promise<AgentReply> {
      const start = monotonic(),
        deadline = start + LIMITS.turnMs;
      let models = 0,
        tools = 0,
        totalBytes = 0;
      const evidence = (code?: string) => ({
        modelCalls: models,
        toolCalls: tools,
        resultBytes: totalBytes,
        ...(code ? { code } : {}),
      });
      const reply = (
        kind: AgentReply["kind"],
        text: string,
        citations: string[] = [],
        code?: string,
      ): AgentReply => ({ kind, text, citations, evidence: evidence(code) });
      async function bounded<T>(
        ms: number,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        const remaining = Math.min(ms, deadline - monotonic());
        if (remaining <= 0) throw new AgentError("DEADLINE");
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value = await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new AgentError("TIMEOUT"));
              }, remaining);
            }),
          ]);
          if (monotonic() >= deadline) throw new AgentError("DEADLINE");
          return value;
        } finally {
          if (timer) clearTimeout(timer);
          controller.abort();
        }
      }
      async function model(task: ModelTask, input: unknown) {
        if (models >= LIMITS.models) throw new AgentError("MODEL_BUDGET");
        models++;
        return bounded(LIMITS.modelMs, (signal) =>
          options.model.generate(task, input, signal),
        );
      }
      try {
        const input = inputSchema.parse(untrusted);
        const ctx = (): PermissionContext => ({
          ...input.ctx,
          now: InstantSchema.parse(clock()),
        });
        const key = ContextKeySchema.parse({
          tenantId: input.ctx.tenantId,
          actorId: input.ctx.actorId,
          conversationId: input.conversationId,
        });
        const stored = await bounded(LIMITS.turnMs, () =>
          options.store.load(key),
        );
        const context = stored === null ? null : ContextSchema.parse(stored);
        if (
          context &&
          (context.tenantId !== key.tenantId ||
            context.actorId !== key.actorId ||
            context.conversationId !== key.conversationId)
        )
          throw new AgentError("CONTEXT_SCOPE");
        let selection = context?.selection ?? null;
        const text = scrub(input.text);
        const history = boundedMessages(
          (context?.messages ?? []).map((message) => ({
            ...message,
            text: scrub(message.text),
          })),
        );
        let access: AccessSnapshot | null = null;
        const used = new Map<
          string,
          { ids: string[]; scopes: Scope[]; version: string }
        >();
        async function check(ids: string[], scopes: Scope[]) {
          if (ids.some((id) => !input.accountIds.includes(id)))
            throw new AgentError("PERMISSION_DENIED");
          const result = await bounded(LIMITS.toolMs, () =>
            options.access.check(ctx(), ids, scopes),
          );
          if (
            canonical(result.accountIds) !== canonical(ids) ||
            !result.version ||
            result.version.length > 256 ||
            Date.parse(InstantSchema.parse(result.expiresAt)) <=
              Date.parse(clock())
          )
            throw new AgentError("PERMISSION_DENIED");
          const k = canonical([ids, scopes]);
          if (used.has(k) && used.get(k)!.version !== result.version)
            throw new AgentError("ACCESS_CHANGED");
          used.set(k, { ids, scopes, version: result.version });
          return result;
        }
        async function recheck() {
          for (const u of [...used.values()]) await check(u.ids, u.scopes);
        }
        async function finish(value: AgentReply) {
          await recheck();
          const next: ConversationContext = {
            ...key,
            schemaVersion: 1,
            revision: (context?.revision ?? 0) + 1,
            messages: boundedMessages([
              ...history,
              { role: "user", text: text.slice(0, 1800) },
              {
                role: "assistant",
                text:
                  value.kind === "general"
                    ? scrub(value.text)
                    : `[${value.kind} response; re-read current sources for facts]`,
              },
            ]),
            selection,
          };
          const saved = await bounded(LIMITS.turnMs, () =>
            options.store.compareAndSwap(key, context?.revision ?? null, next),
          );
          if (!saved)
            return reply(
              "conflict",
              "This conversation changed while I was working. Please repeat your request.",
              [],
              "CONTEXT_CONFLICT",
            );
          await recheck();
          return value;
        }
        async function financial(
          ids: string[],
          kind: "financial" | "clarify" = "financial",
          code?: string,
        ) {
          await recheck();
          const selected = ids.map((id) => facts.get(id)!);
          for (const f of selected) {
            // Display labels come only from the server's current permission snapshot.
            for (const [id, label] of Object.entries(access?.labels ?? {})) {
              f.presentation.scope = f.presentation.scope.replace(
                id,
                scrub(label),
              );
              f.presentation.records = f.presentation.records.map((r) =>
                r.account === id ? { ...r, account: scrub(label) } : r,
              );
            }
          }
          const presentation = factualPresentation(selected);
          try {
            if (code || monotonic() + 1000 >= deadline)
              throw new AgentError("NARRATION_BUDGET");
            const contract = narrationContract(selected);
            const raw = await model("narrate", {
              question: text,
              facts: selected.map((f) => ({
                resultId: f.resultId,
                ...(f.modelData as object),
              })),
              authoring: contract,
            });
            await recheck();
            presentation.explanation = acceptNarration(raw, selected);
            presentation.narration = "ai";
          } catch {
            // Only narration may fall back. Revoked/stale facts must still fail.
            await recheck();
          }
          const canonicalText = selected.map((f) => f.text).join("\n\n");
          const value = reply(
            kind,
            presentation.narration === "ai"
              ? `${presentation.explanation.join("\n\n")}\n\n${canonicalText}`
              : canonicalText,
            ids,
            code,
          );
          value.presentation = presentation;
          return finish(value);
        }
        // Classification has no financial results, selections, principal, account or consent metadata.
        let route = RouteSchema.parse(
          await model("classify", { text, history }),
        ).route;
        const payment = paymentIntent(text);
        if (payment) route = payment;
        else if (
          (route === "payment_action" || route === "payment_draft") &&
          historicalReadIntent(input.text)
        )
          // Inspect original text so scrubbing cannot hide action intent. This
          // only enters the existing permission-checked, read-only tool loop.
          route = "financial_read";
        if (
          route === "general" &&
          (/\bAGUS\b/i.test(text) ||
            /what can you|your capabilities/i.test(text))
        )
          route = "product";
        if (
          route === "general" &&
          (financialLanguage(text) ||
            (selection &&
              /\b(?:one|that|it|those|smaller|larger|first|second|third|same)\b/i.test(
                text,
              )))
        )
          route = "financial_read";
        if (route === "financial_education" && personalFinancialRequest(text))
          route = "financial_read";
        if (route === "payment_draft") {
          selection = null;
          const value = reply(
            "handoff",
            "Continue in the existing editable payment-draft workflow. Review all details there; nothing has been verified or submitted here.",
          );
          value.handoff = { kind: "existing_payment_draft" };
          return await finish(value);
        }
        if (route === "payment_action")
          return await finish(
            reply(
              "clarify",
              "Chat cannot approve, submit, retry or execute payments. Use the existing authenticated payment review workflow.",
            ),
          );
        if (route === "product") {
          const { topic } = z
            .strictObject({ topic: ProductTopicSchema })
            .parse(
              await model("product", { text, knowledge: PRODUCT_KNOWLEDGE }),
            );
          return await finish(reply("product", productAnswer(topic)));
        }
        if (route === "general" || route === "financial_education") {
          const educational = route === "financial_education";
          // Education never receives persisted financial context, even after revocation.
          if (educational) selection = null;
          const draft = GeneralSchema.parse(
            await model("general", {
              text,
              history: educational ? [] : history,
              educational,
            }),
          );
          const review = ReviewSchema.parse(
            await model("review_general", {
              question: text,
              answer: draft.text,
              educational,
            }),
          );
          // Fixed codes only: no draft, question, provider body or record in diagnostics.
          if (!review.safeGeneralConversation)
            throw new AgentError("GENERAL_MODEL_REJECTED");
          if (
            educational
              ? personalFinancialLanguage(draft.text)
              : financialLanguage(draft.text)
          )
            throw new AgentError(
              educational
                ? "GENERAL_POLICY_EDUCATION"
                : "GENERAL_POLICY_FINANCIAL",
            );
          if (actionClaim(draft.text))
            throw new AgentError("GENERAL_POLICY_ACTION");
          // Normal prose formatting is safe; retain every disclosure/control check.
          const disclosureText = draft.text.replace(/[\r\n\t]/g, " ");
          if (scrub(disclosureText) !== disclosureText)
            throw new AgentError("GENERAL_POLICY_DISCLOSURE");
          return await finish(reply("general", draft.text));
        }
        if (!input.accountIds.length)
          return await finish(reply("clarify", QUESTIONS.account));
        if (
          input.accountIds.length > 1 &&
          !selection &&
          !input.accountIds.some((id) => text.includes(id)) &&
          !/\b(?:all|both)\b.{0,20}\baccounts\b/i.test(text)
        )
          return await finish(reply("clarify", QUESTIONS.account));
        access = await check(input.accountIds, []);
        if (
          selection &&
          (selection.accessVersion !== access.version ||
            Date.parse(selection.expiresAt) <= Date.parse(clock()) ||
            selection.accountIds.some((id) => !input.accountIds.includes(id)))
        ) {
          selection = null;
          return await finish(
            reply(
              "clarify",
              "The saved selection expired or its source/permissions changed. Please search again.",
              [],
              "SELECTION_STALE",
            ),
          );
        }
        // No approximate tolerance, ambiguous weekday or missing account scope is silently inferred.
        if (/\b(?:about|around|roughly|approximately)\b/i.test(text))
          return await finish(reply("clarify", QUESTIONS.amount));
        // Resolve before disclosure scrubbing, which can redact date-only ISO
        // strings as long numbers. Only validated endpoints leave the resolver.
        const dateWindow = resolveDateWindow(input.text);
        if (dateWindow.kind === "clarify")
          return await finish(reply("clarify", QUESTIONS.date));
        const facts = new Map<string, Fact>();
        const calls = new Set<string>(),
          callIds = new Set<string>();
        const details = new Map<
          string,
          { revision: number; amountKobo: number }
        >();
        const priorCandidates = selection?.candidates ?? [];
        async function execute(call: ToolCall): Promise<ReadResult> {
          if (tools >= LIMITS.tools) throw new AgentError("TOOL_BUDGET");
          const signature = canonical([call.name, call.args]);
          if (calls.has(signature) || callIds.has(call.callId))
            throw new AgentError("REPEATED_CALL");
          calls.add(signature);
          callIds.add(call.callId);
          const ids =
            "accountIds" in call.args
              ? call.args.accountIds
              : [call.args.accountId];
          const scopes: Scope[] =
            call.name === "get_account_summary"
              ? ["accounts:read"]
              : call.name === "find_payment_evidence"
                ? ["transactions:read", "evidence:read"]
                : ["transactions:read"];
          await check(ids, scopes);
          if (
            call.name === "find_payment_evidence" &&
            !details.has(`${call.args.accountId}:${call.args.transactionId}`)
          )
            throw new AgentError("DETAIL_REQUIRED");
          if (
            call.name === "get_transaction" &&
            priorCandidates.length &&
            !priorCandidates.some(
              (c) =>
                c.accountId === call.args.accountId &&
                c.transactionId === call.args.transactionId,
            )
          )
            throw new AgentError("SELECTION_INVALID");
          if (call.name === "search_transactions" && call.args.cursor !== null)
            throw new AgentError("CURSOR_NOT_EXPOSED");
          tools++;
          const raw = await bounded(LIMITS.toolMs, () =>
            options.tools.dispatch(ctx(), call),
          );
          await recheck();
          totalBytes += bytes(raw);
          if (totalBytes > LIMITS.turnBytes) throw new AgentError("TURN_BYTES");
          const { fact, result } = makeFact(call, raw);
          if (facts.has(fact.resultId)) throw new AgentError("RESULT_REPLAY");
          if (call.name === "get_transaction" && result.data) {
            const detail = ToolArgsSchemas.get_transaction.parse(call.args);
            const data = result.data as {
              id: string;
              accountId: string;
              revision: number;
              amountKobo: number;
            };
            const prior = priorCandidates.find(
              (c) =>
                c.accountId === detail.accountId &&
                c.transactionId === detail.transactionId,
            );
            if (prior && prior.revision !== data.revision)
              throw new AgentError("SELECTION_STALE");
            details.set(`${data.accountId}:${data.id}`, data);
          }
          facts.set(fact.resultId, fact);
          return result;
        }
        while (models < LIMITS.models && tools < LIMITS.tools) {
          await recheck();
          const decision = DecisionSchema.parse(
            await model("plan", {
              text,
              history,
              now: ctx().now,
              timezone: "Africa/Lagos",
              dateWindow:
                dateWindow.kind === "resolved" ? dateWindow.interval : null,
              accountIds: input.accountIds,
              selection: selection
                ? {
                    candidates: selection.candidates.map((candidate) => ({
                      ...candidate,
                      untrustedCounterpartyLabel:
                        candidate.untrustedCounterpartyLabel
                          ? scrub(candidate.untrustedCounterpartyLabel).slice(
                              0,
                              100,
                            )
                          : null,
                    })),
                    filter: selection.filter,
                  }
                : null,
              results: [...facts.values()].map((f) => ({
                resultId: f.resultId,
                ...(f.modelData as object),
              })),
              tools: Object.fromEntries(
                Object.entries(ToolArgsSchemas).map(([name, schema]) => [
                  name,
                  z.toJSONSchema(schema),
                ]),
              ),
            }),
          );
          await recheck();
          if (decision.kind === "clarify")
            return await finish(reply("clarify", QUESTIONS[decision.reason]));
          if (decision.kind === "respond") {
            if (
              new Set(decision.resultIds).size !== decision.resultIds.length ||
              decision.resultIds.some((id) => !facts.has(id))
            )
              throw new AgentError("UNCITED_RESPONSE");
            return await financial(decision.resultIds);
          }
          let call = ToolCallSchema.parse(decision.call);
          if (
            call.name === "search_transactions" ||
            call.name === "calculate_spending"
          ) {
            if (dateWindow.kind !== "resolved")
              return await finish(reply("clarify", QUESTIONS.date));
            // Only interval fields are authoritative here. Keep account scope and
            // all other model filters subject to the existing validation/checks.
            call = ToolCallSchema.parse({
              ...call,
              args: { ...call.args, ...dateWindow.interval },
            });
          }
          const result = await execute(call);
          if (result.error)
            return await finish(
              reply(
                "unavailable",
                facts.get(result.meta.resultId)!.text,
                [result.meta.resultId],
                result.error.code,
              ),
            );
          if (call.name === "search_transactions" && result.data) {
            const data =
              result.data as import("../financial-data/contracts").ToolData["search_transactions"];
            if (data.matches.length)
              selection = {
                resultId: result.meta.resultId,
                accountIds: [...input.accountIds],
                candidates: data.matches.map((t) => ({
                  accountId: t.accountId,
                  transactionId: t.id,
                  untrustedCounterpartyLabel: t.counterparty.displayName
                    ? scrub(t.counterparty.displayName).slice(0, 100)
                    : null,
                  revision: t.revision,
                  amountKobo: t.amountKobo,
                })),
                filter: ReadFilterSchema.parse(
                  Object.fromEntries(
                    Object.entries(call.args).filter(
                      ([k]) => !["query", "limit", "cursor"].includes(k),
                    ),
                  ),
                ),
                accessVersion: access.version,
                expiresAt: new Date(
                  Math.min(
                    Date.parse(clock()) + 15 * 60000,
                    Date.parse(access.expiresAt),
                  ),
                ).toISOString(),
              };
            else selection = null;
            if (data.selection !== "single_candidate")
              return await financial(
                [result.meta.resultId],
                data.selection === "ambiguous" ? "clarify" : "financial",
              );
          }
        }
        // At a loop limit the deterministic renderer may disclose only completed, rechecked facts.
        if (facts.size)
          return await finish(
            reply(
              "financial",
              [...facts.values()].map((f) => f.text).join("\n\n") +
                "\nThe read limit was reached; narrow the request to continue.",
              [...facts.keys()],
              "LOOP_LIMIT",
            ),
          );
        throw new AgentError("MODEL_BUDGET");
      } catch (error) {
        const code =
          error instanceof AgentError
            ? error.code
            : "VALIDATION_OR_DEPENDENCY_FAILURE";
        return reply("unavailable", UNAVAILABLE, [], code);
      }
    },
  };
}
