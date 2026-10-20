import { createElement } from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinancialResponse } from "../../src/components/financial-response";
import type { AgentReply } from "../../src/lib/financial-agent";
it("preserves the complete legacy or malformed response and its caveats", () => {
  const original =
    "Legacy amount ₦7,500.00. Coverage unknown; this does not establish bank credit.\nOriginal source: fixture.";
  for (const presentation of [
    undefined,
    { version: 999 },
    {
      version: 1,
      narration: "ai",
      explanation: ["incomplete"],
      results: [{ type: "calculate_spending", metrics: [] }],
    },
  ]) {
    const reply = {
      kind: "financial",
      text: original,
      citations: [],
      evidence: { modelCalls: 0, toolCalls: 0, resultBytes: 0 },
      presentation,
    } as AgentReply;
    const html = renderToStaticMarkup(
      createElement(FinancialResponse, { reply, choose: () => {} }),
    );
    expect(html).toContain("₦7,500.00");
    expect(html).toContain("does not establish bank credit");
    expect(html).toContain("Original source: fixture.");
    expect(html).not.toContain("₦0.00");
    expect(html).not.toContain("incomplete");
  }
});
