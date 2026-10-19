import { describe, expect, it, vi } from "vitest";
import { ToolCallSchema } from "../../src/lib/financial-data/contracts";
import { evidence, scripted, search, setup } from "./helpers";

const respond = (_task: string, input: { results: { resultId: string }[] }) => ({
  kind: "respond",
  resultIds: input.results.map((r) => r.resultId),
});

describe("Persisted evidence selection keeps fresh-detail safeguards", () => {
  it("automatically reads saved candidate details before evidence", async () => {
    const s = setup(scripted(
      { route: "financial_read" }, search("Ada"), respond,
      { route: "financial_read" }, evidence("ada-okafor-oct"), respond,
    ));
    const first = await s.agent().turn({
      ...s.input, text: "Find Ada payments on amina-current for October 2026.",
    });
    expect(first.kind).toBe("financial");
    expect(first.evidence.toolCalls).toBe(1);

    const second = await s.agent().turn({
      ...s.input, text: "The smaller one; show me its payment evidence.",
    });
    expect(second.kind).toBe("financial");
    expect(second.evidence.toolCalls).toBe(2);
    expect(second.text).toContain("Fictional synthetic evidence");
    const names = vi.mocked(s.tools.dispatch).mock.calls.map(
      ([, call]) => ToolCallSchema.parse(call).name,
    );
    expect(names).toEqual([
      "search_transactions", "get_transaction", "find_payment_evidence",
    ]);
  });

  it("does not automatically read unlisted transaction IDs", async () => {
    const s = setup(scripted(
      { route: "financial_read" }, search("Ada"), respond,
      { route: "financial_read" }, evidence("unlisted-transaction"),
    ));
    await s.agent().turn({
      ...s.input, text: "Find Ada payments on amina-current for October 2026.",
    });
    const second = await s.agent().turn({
      ...s.input, text: "The smaller one; show me its payment evidence.",
    });
    expect(second.kind).toBe("unavailable");
    expect(second.evidence.code).toBe("DETAIL_REQUIRED");
    expect(vi.mocked(s.tools.dispatch).mock.calls.map(
      ([, call]) => call.name,
    )).toEqual(["search_transactions"]);
  });
});
