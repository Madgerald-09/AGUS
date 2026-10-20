import {
  createFixtureDataset,
  createFixtureDataSource,
  createReadTools,
  MemoryFinancialRepository,
  FIXTURE_NOW,
  fixturePrincipal,
  lagosDateInterval,
  type BankingDataSource,
  type FixtureDataset,
  type ToolArgs,
  type ToolCall,
  type ToolName,
} from "../../src/lib/financial-data";
export const october = lagosDateInterval("2026-10-01", "2026-11-01");
export const filter = { accountIds: ["amina-current"], ...october };
export const searchArgs: ToolArgs["search_transactions"] = {
  ...filter,
  query: "",
  limit: 10,
  cursor: null,
};
export const calcArgs: ToolArgs["calculate_spending"] = {
  ...filter,
  groupBy: "none",
};
export function call<K extends ToolName>(
  name: K,
  args: ToolArgs[K],
): ToolCall<K> {
  return {
    protocolVersion: 1,
    callId: `call-${name}`,
    name,
    args,
  } as ToolCall<K>;
}
export function setup(
  change?: (data: FixtureDataset) => void,
  wrap?: (
    source: BankingDataSource,
    repository: MemoryFinancialRepository,
  ) => BankingDataSource,
  timeoutMs?: number,
) {
  const data = createFixtureDataset();
  change?.(data);
  const repository = new MemoryFinancialRepository(data);
  let now: string = FIXTURE_NOW;
  const clock = () => now;
  const source = createFixtureDataSource({ repository, clock });
  const provider = wrap ? wrap(source, repository) : { ...source };
  const tools = createReadTools({
    repository,
    sources: [provider],
    clock,
    timeoutMs,
  });
  return {
    data,
    repository,
    source,
    provider,
    tools,
    ctx: fixturePrincipal,
    clock,
    setNow: (value: string) => {
      now = value;
    },
  };
}
