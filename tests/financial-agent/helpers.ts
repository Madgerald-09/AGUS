import { vi } from "vitest";
import {
  createFixtureDataset,
  createFixtureDataSource,
  createReadTools,
  MemoryFinancialRepository,
  FIXTURE_NOW,
  fixturePrincipal,
  lagosDateInterval,
  type ToolCall,
  type ToolArgs,
  type ToolName,
  type ReadToolDispatcher,
  type FixtureDataset,
} from "../../src/lib/financial-data";
import {
  createFinancialAgent,
  createRepositoryAccess,
  MemoryContextStore,
  type AgentModel,
  type ModelTask,
  type AgentOptions,
} from "../../src/lib/financial-agent";
export const filter = {
  accountIds: ["amina-current"],
  ...lagosDateInterval("2026-10-01", "2026-11-01"),
};
export const calc = {
  kind: "call_tool",
  call: {
    protocolVersion: 1,
    callId: "calc-1",
    name: "calculate_spending",
    args: { ...filter, groupBy: "none" },
  },
};
export function step<K extends ToolName>(
  name: K,
  args: ToolArgs[K],
  callId: string = name,
): { kind: "call_tool"; call: ToolCall<K> } {
  return {
    kind: "call_tool",
    call: { protocolVersion: 1, callId, name, args } as ToolCall<K>,
  };
}
export const search = (query = "Ada", limit = 10) =>
  step("search_transactions", { ...filter, query, limit, cursor: null });
export const detail = (transactionId = "ada-okafor-oct") =>
  step("get_transaction", { accountId: "amina-current", transactionId });
export const evidence = (transactionId = "ada-okafor-oct") =>
  step("find_payment_evidence", { accountId: "amina-current", transactionId });
export function scripted(...outputs: unknown[]) {
  const generate = vi.fn(
    async (_task: ModelTask, _input: unknown, _signal: AbortSignal) => {
      if (!outputs.length) throw new Error("script exhausted");
      const next = outputs.shift();
      return typeof next === "function" ? next(_task, _input, _signal) : next;
    },
  );
  return {
    provider: "test-double",
    model: "scripted-test-only",
    generate,
  } satisfies AgentModel;
}
export function setup<M extends AgentModel>(
  model: M,
  change?: (d: FixtureDataset) => void,
) {
  const data = createFixtureDataset();
  change?.(data);
  const repository = new MemoryFinancialRepository(data);
  let now = FIXTURE_NOW;
  const clock = () => now;
  const source = createFixtureDataSource({ repository, clock });
  const realTools = createReadTools({ repository, sources: [source], clock });
  const tools: ReadToolDispatcher = {
    ...realTools,
    dispatch: vi.fn(realTools.dispatch),
  };
  const store = new MemoryContextStore();
  const access = createRepositoryAccess(repository, clock);
  const options: AgentOptions = { model, tools, store, access, clock };
  const input = {
    ctx: fixturePrincipal,
    conversationId: "chat-1",
    text: "Check October spending",
    accountIds: ["amina-current"],
  };
  return {
    data,
    repository,
    source,
    realTools,
    tools,
    store,
    access,
    model,
    options,
    input,
    clock,
    setNow: (t: string) => {
      now = t;
    },
    agent: () => createFinancialAgent(options),
  };
}
export const financial = { route: "financial_read" };
