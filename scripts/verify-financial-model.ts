/** Manual genuine inference gate. No mocked transport, parser fallback or payment import. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createConfiguredModel,
  createFinancialAgent,
  createRepositoryAccess,
  MemoryContextStore,
  AgentError,
  type AgentReply,
} from "../src/lib/financial-agent/index";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data/index";

const provider = process.env.AI_PROVIDER ?? "none";
const configuredModel = createConfiguredModel();
const safeModel = /^[A-Za-z0-9._-]{1,100}$/.test(configuredModel.model)
  ? configuredModel.model
  : "custom-model";
const started = performance.now();
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
  fixtureClock: FIXTURE_NOW,
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
  const repository = createFixtureRepository();
  const clock = () => FIXTURE_NOW;
  const source = createFixtureDataSource({ repository, clock });
  const tools = createReadTools({ repository, sources: [source], clock });
  const agent = createFinancialAgent({
    model: configuredModel,
    tools,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
  });
  const replies: AgentReply[] = [];
  async function check(
    id: string,
    text: string,
    accepts: (r: AgentReply) => boolean,
    conversationId = id,
  ) {
    const begin = performance.now();
    const result = await agent.turn({
      ctx: fixturePrincipal,
      conversationId,
      accountIds: ["amina-current"],
      text,
    });
    const pass = accepts(result);
    (record.cases as unknown[]).push({
      id,
      status: pass ? "PASS" : "BLOCKED",
      kind: result.kind,
      schemaOutcome: result.kind === "unavailable" ? "unverified" : "validated",
      latencyMs: Math.round(performance.now() - begin),
      ...result.evidence,
    });
    replies.push(result);
    if (!pass) throw new AgentError("SCENARIO_NOT_VERIFIED");
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
  record.status = "PASS";
  record.reason = "ALL_SYNTHETIC_SCENARIOS_VERIFIED";
} catch (error) {
  record.reason =
    error instanceof AgentError ? error.code : "VERIFICATION_ERROR";
} finally {
  record.latencyMs = Math.round(performance.now() - started);
  console.log(JSON.stringify(record, null, 2));
  process.exitCode = record.status === "PASS" ? 0 : 2;
}
