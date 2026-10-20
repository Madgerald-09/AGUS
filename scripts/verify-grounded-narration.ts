/** Genuine provider gate. No mocked transport or payment mutation. Output is metadata only. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createConfiguredModel,
  createFinancialAgent,
  createRepositoryAccess,
  MemoryContextStore,
} from "../src/lib/financial-agent";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data";
const configured = createConfiguredModel();
const calls: string[] = [];
const report: Record<string, unknown> = {
  status: "UNVERIFIED",
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  provider: configured.provider,
  model: /^[a-z0-9._-]+$/i.test(configured.model) ? configured.model : "custom",
  dataMode: "fictional fixtures",
  inferenceMode: "genuine configured provider; no mock",
  calls,
  cases: [],
};
try {
  if (
    !process.env.AI_API_KEY ||
    !["gemini", "openai"].includes(configured.provider)
  )
    throw new Error("MODEL_NOT_CONFIGURED");
  const repository = createFixtureRepository(),
    clock = () => FIXTURE_NOW;
  const agent = createFinancialAgent({
    model: {
      provider: configured.provider,
      model: configured.model,
      async generate(task, input, signal) {
        calls.push(task);
        return configured.generate(task, input, signal);
      },
    },
    tools: createReadTools({
      repository,
      sources: [createFixtureDataSource({ repository, clock })],
      clock,
    }),
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
  });
  const chat = randomUUID();
  for (const [id, text] of [
    ["spending-partial", "Show my spending for October 2026"],
    ["ambiguous", "Find payments to Ada in October 2026"],
    ["follow-up", "Show details for the first candidate"],
    ["evidence", "Show the payment evidence for the first candidate"],
    [
      "no-matches",
      "Find payments to Nonexistent Fictional Label in October 2026",
    ],
  ]) {
    const before = calls.length;
    const r = await agent.turn({
      ctx: fixturePrincipal,
      conversationId: chat,
      text,
      accountIds: ["amina-current"],
    });
    const passed =
      r.presentation?.narration === "ai" &&
      calls.slice(before).includes("narrate") &&
      r.presentation.results.every((f) => r.citations.includes(f.resultId)) &&
      (id !== "spending-partial" ||
        r.presentation.results[0].metrics.map((m) => m.value).join("|") ===
          "₦19,751.51|₦250,000.00|₦230,248.49");
    (report.cases as unknown[]).push({
      id,
      status: passed ? "PASS" : "UNVERIFIED",
      narration: r.presentation?.narration ?? "none",
      kind: r.kind,
      code: r.evidence.code ?? null,
      modelCalls: r.evidence.modelCalls,
    });
    if (!passed) throw new Error("NARRATION_NOT_VERIFIED");
  }
  report.status = "PASS";
} catch (e) {
  report.reason =
    e instanceof Error && /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "PROVIDER_OR_VALIDATION_UNAVAILABLE";
  process.exitCode = 2;
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
