/** Controls and result grading for the existing genuine gate; no inference transport. */
import type { AgentReply } from "../src/lib/financial-agent";

export function scenarioStatus(
  accepted: boolean,
  grounded: boolean,
  reply: AgentReply,
) {
  if (!accepted || !grounded) return "BLOCKED";
  const needsNarration =
    reply.kind === "financial" ||
    (reply.kind === "clarify" && reply.evidence.toolCalls > 0);
  return needsNarration && reply.presentation?.narration !== "ai"
    ? "UNVERIFIED"
    : "PASS";
}

export const baselineScenarios = [
  "general-story",
  "general-support",
  "education-no-account",
  "personal-no-account",
  "product",
  "totals",
  "multi-step",
  "ambiguous",
  "follow-up",
  "missing",
  "payment-handoff",
  "execution-refusal",
] as const;
export const scenarioIds = [
  ...baselineScenarios,
  "general-greeting",
  "general-everyday",
  "general-knowledge",
  "education-interest",
  "education-budget",
  "education-profit",
  "relative-month",
  "compare-september",
  "pending-follow-up",
] as const;
export type ScenarioId = (typeof scenarioIds)[number];

export function verificationOptions(args: string[]) {
  const options = {
    selected: [...baselineScenarios] as ScenarioId[],
    minIntervalMs: 5000,
    maxModelCalls: 60,
    includeResponses: false,
    list: false,
  };
  let selected = false;
  const seen = new Set<string>();
  for (const arg of args) {
    const [name, value, extra] = arg.split("=");
    if (extra !== undefined || seen.has(name))
      throw new Error("INVALID_OPTIONS");
    seen.add(name);
    if (name === "--list" && value === undefined) options.list = true;
    else if (name === "--include-responses" && value === undefined)
      options.includeResponses = true;
    else if (name === "--scenario" && value) {
      const ids = value.split(",");
      if (ids.some((id) => !scenarioIds.includes(id as ScenarioId)))
        throw new Error("INVALID_SCENARIO");
      options.selected = [...new Set(ids)] as ScenarioId[];
      selected = true;
    } else if (
      ["--min-interval-ms", "--max-model-calls"].includes(name) &&
      value &&
      /^\d+$/.test(value)
    ) {
      const n = Number(value);
      if (
        !Number.isSafeInteger(n) ||
        (name === "--min-interval-ms" ? n > 10000 : n < 1 || n > 120)
      )
        throw new Error("INVALID_BUDGET");
      if (name === "--min-interval-ms") options.minIntervalMs = n;
      else options.maxModelCalls = n;
    } else throw new Error("INVALID_OPTIONS");
  }
  const requested = [...options.selected];
  const dependencies: Partial<Record<ScenarioId, ScenarioId>> = {
    "general-support": "general-story",
    "follow-up": "ambiguous",
    "relative-month": "totals",
    "compare-september": "totals",
    "pending-follow-up": "ambiguous",
  };
  for (const id of requested) {
    const dependency = dependencies[id];
    if (dependency && !options.selected.includes(dependency))
      options.selected.push(dependency);
  }
  options.selected = scenarioIds.filter((id) => options.selected.includes(id));
  return {
    ...options,
    requested: selected ? requested : [...baselineScenarios],
  };
}
