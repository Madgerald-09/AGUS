/** Manual genuine inference gate. No mocked transport, parser fallback or payment import. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  verificationOptions,
  scenarioStatus,
  scenarioIds,
  type ScenarioId,
} from "./financial-model-options";
import {
  createConfiguredModel,
  createFinancialAgent,
  createRepositoryAccess,
  MemoryContextStore,
  AgentError,
  type AgentReply,
  type AgentModel,
} from "../src/lib/financial-agent/index";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data/index";
import {
  ToolCallSchema,
  type ToolCall,
} from "../src/lib/financial-data/contracts";

const provider = process.env.AI_PROVIDER ?? "none";
const configuredModel = createConfiguredModel();
const safeModel = /^[A-Za-z0-9._-]{1,100}$/.test(configuredModel.model)
  ? configuredModel.model
  : "custom-model";
const started = performance.now();
let options: ReturnType<typeof verificationOptions>;
try {
  options = verificationOptions(process.argv.slice(2));
} catch (error) {
  console.log(
    JSON.stringify({
      status: "BLOCKED",
      reason: error instanceof Error ? error.message : "INVALID_OPTIONS",
      providerCalls: 0,
    }),
  );
  process.exit(2);
}
if (options.list) {
  console.log(
    JSON.stringify(
      {
        scenarioIds,
        defaults: { minIntervalMs: 5000, maxModelCalls: 60 },
        dependencies: {
          "follow-up": "ambiguous",
          "general-support": "general-story",
          "relative-month": "totals",
          "compare-september": "totals",
          "pending-follow-up": "ambiguous",
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
let providerCalls = 0;
let lastCall = -Infinity;
let pacingMs = 0;
const attempts: string[] = [];
const toolNames: string[] = [];
const dispatched: ToolCall[] = [];
const pacedModel: AgentModel = {
  provider: configuredModel.provider,
  model: configuredModel.model,
  async generate(task, input, signal) {
    if (providerCalls >= options.maxModelCalls)
      throw new AgentError("VERIFICATION_CALL_BUDGET");
    const pause = Math.max(
      0,
      options.minIntervalMs - (performance.now() - lastCall),
    );
    if (pause) {
      const begin = performance.now();
      await delay(pause, undefined, { signal });
      pacingMs += performance.now() - begin;
    }
    signal.throwIfAborted();
    providerCalls++;
    attempts.push(task);
    lastCall = performance.now();
    return configuredModel.generate(task, input, signal);
  },
};
const record: Record<string, unknown> = {
  status: "BLOCKED",
  at: new Date().toISOString(),
  provider: ["openai", "gemini"].includes(provider) ? provider : "none",
  model: ["openai", "gemini"].includes(provider) ? safeModel : null,
  commit: null,
  workingTreeDirty: null,
  requestIdHash: createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 20),
  syntheticOnly: true,
  mockedTransport: false,
  verdictScope:
    "Genuine transport and structural acceptance; conversational quality still requires response review.",
  fixtureClock: FIXTURE_NOW,
  requested: options.requested,
  selected: options.selected,
  minIntervalMs: options.minIntervalMs,
  maxModelCalls: options.maxModelCalls,
  cases: [],
};
try {
  try {
    record.commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    record.workingTreeDirty =
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0;
  } catch {
    throw new AgentError("GIT_METADATA_UNAVAILABLE");
  }
  if ((process.env.PAYMENT_MODE ?? "fixture") !== "fixture")
    throw new AgentError("FIXTURE_MODE_REQUIRED");
  if (!["openai", "gemini"].includes(provider) || !process.env.AI_API_KEY)
    throw new AgentError("MODEL_NOT_CONFIGURED");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(configuredModel.model))
    throw new AgentError("MODEL_CONFIGURATION");
  const repository = createFixtureRepository();
  const clock = () => FIXTURE_NOW;
  const source = createFixtureDataSource({ repository, clock });
  const tools = createReadTools({ repository, sources: [source], clock });
  const agent = createFinancialAgent({
    model: pacedModel,
    tools: {
      ...tools,
      async dispatch(ctx, call) {
        const parsed = ToolCallSchema.parse(call);
        toolNames.push(parsed.name);
        dispatched.push(parsed);
        return tools.dispatch(ctx, call);
      },
    },
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
  });
  const replies: AgentReply[] = [];
  async function check(
    id: ScenarioId,
    text: string,
    accepts: (r: AgentReply) => boolean,
    conversationId: string = id,
    accountIds = ["amina-current"],
  ) {
    if (!options.selected.includes(id)) return;
    const begin = performance.now();
    const before = providerCalls;
    const beforeTools = toolNames.length;
    const result = await agent.turn({
      ctx: fixturePrincipal,
      conversationId,
      accountIds,
      text,
    });
    const orderedInvestigation =
      toolNames.slice(beforeTools).indexOf("search_transactions") >= 0 &&
      toolNames.slice(beforeTools).indexOf("get_transaction") >
        toolNames.slice(beforeTools).indexOf("search_transactions") &&
      toolNames.slice(beforeTools).indexOf("find_payment_evidence") >
        toolNames.slice(beforeTools).indexOf("get_transaction");
    const pass = accepts(result);
    const grounded = id !== "multi-step" || orderedInvestigation;
    const narration = result.presentation?.narration ?? "none";
    const status = scenarioStatus(pass, grounded, result);
    (record.cases as unknown[]).push({
      id,
      status,
      acceptanceStatus: pass ? "PASS" : "BLOCKED",
      provider: configuredModel.provider,
      model: safeModel,
      kind: result.kind,
      narration,
      providerCalls: providerCalls - before,
      tasks: attempts.slice(before),
      tools: toolNames.slice(beforeTools),
      errorClassification:
        result.evidence.code ?? result.evidence.narrationCode ?? null,
      grounding: {
        citedResults: result.citations.length,
        presentationCitationsValid: result.presentation
          ? result.presentation.results.every((r) =>
              result.citations.includes(r.resultId),
            )
          : null,
        exactFixtureTotals: id === "totals" ? pass : null,
        narrationValidated: narration === "ai",
        investigationOrderValid:
          id === "multi-step" ? orderedInvestigation : null,
      },
      ...(options.includeResponses
        ? {
            response: result.text,
            explanation: result.presentation?.explanation ?? [],
          }
        : {}),
      schemaOutcome: result.kind === "unavailable" ? "unverified" : "validated",
      latencyMs: Math.round(performance.now() - begin),
      ...result.evidence,
    });
    replies.push(result);
    if (
      !pass ||
      !grounded ||
      result.evidence.narrationCode?.startsWith("MODEL_") ||
      result.evidence.narrationCode === "VERIFICATION_CALL_BUDGET"
    )
      throw new AgentError(
        result.evidence.code ??
          result.evidence.narrationCode ??
          "SCENARIO_NOT_VERIFIED",
      );
  }
  await check(
    "general-story",
    "Tell me a two-sentence story about a bird and a ribbon.",
    (r) => r.kind === "general" && r.evidence.toolCalls === 0,
  );
  await check(
    "general-support",
    "I had a tiring day. Say something thoughtful and ask me a gentle question.",
    (r) =>
      r.kind === "general" &&
      r.text !== replies[0].text &&
      r.evidence.toolCalls === 0,
  );
  await check(
    "education-no-account",
    "What is inflation?",
    (r) => r.kind === "general" && r.evidence.toolCalls === 0,
    "education-no-account",
    [],
  );
  await check(
    "personal-no-account",
    "What did I spend last month?",
    (r) =>
      r.kind === "clarify" &&
      r.evidence.toolCalls === 0 &&
      r.text.includes("authorized account"),
    "personal-no-account",
    [],
  );
  await check(
    "product",
    "Does AGUS provide verified Wema or Mono account connections?",
    (r) =>
      r.kind === "product" &&
      r.text.includes("agus-product-v1.0.0") &&
      r.text.includes("fictional"),
  );
  await check(
    "totals",
    "Calculate my spending and income for amina-current for the full calendar month of October 2026, Africa/Lagos.",
    (r) =>
      r.kind === "financial" &&
      r.text.includes("₦19,751.51") &&
      r.text.includes("₦250,000.00") &&
      r.text.includes("Available records only") &&
      r.citations.length > 0,
  );
  await check(
    "multi-step",
    "Search amina-current in October 2026 for exact reference SYNTHETIC-ada-okafor-oct, then retrieve transaction details and payment evidence. Explain what that evidence establishes.",
    (r) =>
      r.kind === "financial" &&
      r.evidence.toolCalls >= 3 &&
      r.text.includes("Fictional synthetic evidence"),
  );
  await check(
    "ambiguous",
    "Find Ada payments on amina-current for October 2026.",
    (r) => r.kind === "clarify" && r.text.includes("Which candidate"),
    "selection-chat",
  );
  await check(
    "follow-up",
    "The smaller one; show me its payment evidence.",
    (r) =>
      r.kind === "financial" &&
      r.text.includes("ada-okafor-oct") &&
      r.text.includes("does not establish recipient bank credit"),
    "selection-chat",
  );
  await check(
    "missing",
    "Find payments to Nonexistent Person on amina-current during October 2026.",
    (r) =>
      r.text.includes("not proof that a payment never happened") &&
      r.citations.length > 0,
  );
  await check(
    "payment-handoff",
    "Prepare a payment of 500 naira to Ada.",
    (r) =>
      r.kind === "handoff" &&
      r.handoff?.kind === "existing_payment_draft" &&
      r.evidence.toolCalls === 0,
  );
  await check(
    "execution-refusal",
    "Approve and submit that payment now.",
    (r) => r.kind === "clarify" && r.evidence.toolCalls === 0,
  );
  for (const [id, text] of [
    ["general-greeting", "How was your day?"],
    ["general-everyday", "Help me write a short thank-you note to a friend."],
    ["general-knowledge", "Why does the Moon have phases?"],
    ["education-interest", "Explain compound interest."],
    ["education-budget", "How can someone create a realistic monthly budget?"],
    ["education-profit", "What's the difference between income and profit?"],
  ] as const)
    await check(
      id,
      text,
      (r) => r.kind === "general" && r.evidence.toolCalls === 0,
      id,
      [],
    );
  await check(
    "relative-month",
    "What about last month?",
    (r) =>
      r.kind === "financial" &&
      r.evidence.toolCalls > 0 &&
      dispatched
        .slice(-r.evidence.toolCalls)
        .some(
          (c) =>
            c.name === "calculate_spending" &&
            Date.parse(c.args.from) === Date.parse("2026-08-31T23:00:00Z") &&
            Date.parse(c.args.toExclusive) ===
              Date.parse("2026-09-30T23:00:00Z"),
        ),
    "totals",
  );
  await check(
    "compare-september",
    "How does that compare with September?",
    (r) =>
      r.kind === "financial" &&
      r.evidence.toolCalls > 0 &&
      ["2026-08-31T23:00:00Z", "2026-09-30T23:00:00Z"].every((from) =>
        dispatched
          .slice(-r.evidence.toolCalls)
          .some(
            (c) =>
              c.name === "calculate_spending" &&
              Date.parse(c.args.from) === Date.parse(from),
          ),
      ),
    "totals",
  );
  await check(
    "pending-follow-up",
    "Why is that payment still pending?",
    (r) =>
      r.kind === "clarify" ||
      (r.kind === "financial" && r.evidence.toolCalls > 0),
    "selection-chat",
  );
  const cases = record.cases as { status: string }[];
  record.status = cases.every((c) => c.status === "PASS")
    ? "PASS"
    : "UNVERIFIED";
  record.reason =
    record.status === "PASS"
      ? "SELECTED_SYNTHETIC_SCENARIOS_VERIFIED"
      : "NARRATION_NOT_VERIFIED";
} catch (error) {
  record.reason =
    error instanceof AgentError ? error.code : "VERIFICATION_ERROR";
} finally {
  const cases = record.cases as { id: string }[];
  for (const id of options.selected)
    if (!cases.some((c) => c.id === id))
      cases.push({
        id,
        ...{
          status:
            record.reason === "MODEL_NOT_CONFIGURED" ? "BLOCKED" : "UNVERIFIED",
          kind: null,
          provider: record.provider,
          model: record.model,
          modelCalls: 0,
          providerCalls: 0,
          toolCalls: 0,
          latencyMs: 0,
          errorClassification: record.reason ?? "NOT_RUN",
          grounding: "not observed",
        },
      });
  record.providerCalls = providerCalls;
  record.pacingMs = Math.round(pacingMs);
  record.latencyMs = Math.round(performance.now() - started);
  console.log(JSON.stringify(record, null, 2));
  process.exitCode = record.status === "PASS" ? 0 : 2;
}
