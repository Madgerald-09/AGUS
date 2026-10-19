import { describe, expect, it } from "vitest";
import {
  baselineScenarios,
  verificationOptions,
  scenarioStatus,
} from "../../scripts/financial-model-options";
import type { AgentReply } from "../../src/lib/financial-agent";

describe("genuine gate selection and quota controls (no provider calls)", () => {
  it("retains the original twelve scenarios and bounds calls by default", () => {
    expect(verificationOptions([])).toMatchObject({
      selected: [...baselineScenarios],
      minIntervalMs: 5000,
      maxModelCalls: 60,
      includeResponses: false,
    });
  });
  it("runs only a requested case and required conversational setup", () => {
    expect(
      verificationOptions([
        "--scenario=follow-up",
        "--max-model-calls=8",
        "--min-interval-ms=6000",
      ]),
    ).toMatchObject({
      selected: ["ambiguous", "follow-up"],
      requested: ["follow-up"],
      maxModelCalls: 8,
      minIntervalMs: 6000,
    });
    expect(verificationOptions(["--scenario=totals"]).selected).toEqual([
      "totals",
    ]);
    expect(
      verificationOptions(["--scenario=general-support"]).selected,
    ).toEqual(["general-story", "general-support"]);
  });
  it("never grades a loop-limit or fallback financial answer as AI narration PASS", () => {
    const reply: AgentReply = {
      kind: "financial",
      text: "Checked facts",
      citations: [],
      evidence: {
        modelCalls: 6,
        toolCalls: 3,
        resultBytes: 0,
        code: "LOOP_LIMIT",
      },
    };
    expect(scenarioStatus(true, true, reply)).toBe("UNVERIFIED");
    reply.presentation = {
      version: 1,
      narration: "factual_fallback",
      explanation: ["Checked facts"],
      results: [],
    };
    expect(scenarioStatus(true, true, reply)).toBe("UNVERIFIED");
    reply.presentation.narration = "ai";
    expect(scenarioStatus(true, true, reply)).toBe("PASS");
    expect(scenarioStatus(false, true, reply)).toBe("BLOCKED");
    expect(scenarioStatus(true, false, reply)).toBe("BLOCKED");
    delete reply.presentation;
    reply.kind = "clarify";
    expect(scenarioStatus(true, true, reply)).toBe("UNVERIFIED");
    reply.evidence.toolCalls = 0;
    expect(scenarioStatus(true, true, reply)).toBe("PASS");
  });
  it.each([
    ["--scenario=unknown"],
    ["--scenario="],
    ["--max-model-calls=0"],
    ["--max-model-calls=121"],
    ["--max-model-calls=Infinity"],
    ["--min-interval-ms=10001"],
    ["--min-interval-ms=-1"],
    ["--max-model-calls=1", "--max-model-calls=2"],
    ["--list=yes"],
    ["--include-responses=yes"],
    ["--secret=withheld"],
  ])("rejects invalid options before inference: %s", (...args) => {
    expect(() => verificationOptions(args)).toThrow(/^INVALID_/);
  });
});
