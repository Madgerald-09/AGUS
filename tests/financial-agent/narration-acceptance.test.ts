import { beforeAll, describe, expect, it } from "vitest";
import {
  acceptNarration,
  narrationContract,
  NarrationError,
} from "../../src/lib/financial-agent/narration";
import { makeFact, type Fact } from "../../src/lib/financial-agent/facts";
import { ToolCallSchema } from "../../src/lib/financial-data/contracts";
import {
  calc,
  scripted,
  setup,
  search,
  detail,
  evidence,
  step,
  financial,
} from "./helpers";

let fact: Fact;
beforeAll(async () => {
  const s = setup(scripted());
  const call = ToolCallSchema.parse(calc.call);
  fact = makeFact(call, await s.realTools.dispatch(s.input.ctx, call)).fact;
});
function answer(
  text: string,
  limits = narrationContract([fact]).required.join(" "),
) {
  return {
    paragraphs: [
      { resultIds: [fact.resultId], text: `${text} ${limits}`.trim() },
    ],
  };
}

describe("natural narration acceptance (deterministic; no provider calls)", () => {
  it.each([
    "Expenses  total {{r0.expenses}} and income totals {{r0.income}}.",
    "Your total spending was {{r0.expenses}}, while your total income was {{r0.income}}.",
    "Based on the available records, you spent {{r0.expenses}} and received {{r0.income}}. The net difference is {{r0.difference}}.",
    "In the available records, spending came to {{r0.expenses}}; income amounted to {{r0.income}}.",
    "Your expenses\nwere {{r0.expenses}} and your income was {{r0.income}}.",
    "Income exceeded expenses by {{r0.difference}} in these records.",
  ])("accepts an accurate bounded paraphrase: %s", (text) => {
    const result = acceptNarration(answer(text), [fact]);
    expect(result.join(" ")).not.toContain("{{");
    expect(result.join(" ")).toContain("Coverage is partial");
  });
  it("tolerates one redundant period after a standalone required limit", () => {
    const result = acceptNarration(
      answer(
        "Expenses total {{r0.expenses}}.",
        narrationContract([fact])
          .required.map((t) => `${t}.`)
          .join("\n"),
      ),
      [fact],
    );
    expect(result[0]).not.toContain("..");
    expect(result[0]).toContain("not an account balance.");
  });
  it("accepts a complete final supported sentence without a period", () => {
    const output = {
      paragraphs: [
        {
          resultIds: [fact.resultId],
          text: `${narrationContract([fact]).required.join(" ")} the net difference is {{r0.difference}}`,
        },
      ],
    };
    expect(acceptNarration(output, [fact])[0]).toMatch(
      /The net difference is ₦230,248\.49\.$/i,
    );
  });
  it.each([
    "Based on the available records, you spent {{r0.expenses}} and received {{r0.income}}, leaving a net difference of {{r0.difference}}.",
    "Income was {{r0.income}}.",
    "The net difference came to {{r0.difference}}.",
    "These records cover {{r0.scope}}.",
  ])("keeps natural values backend-owned: %s", (text) => {
    const rendered = acceptNarration(answer(text), [fact])[0];
    expect(rendered).not.toContain("{{");
    expect(rendered).toContain("not an account balance.");
  });

  it.each([
    "You spent {{r0.income}} and received {{r0.expenses}}.",
    "Your total spending was {{r0.income}}, while your total income was {{r0.expenses}}.",
    "The net difference is {{r0.income}}.",
    "Your bank balance is {{r0.difference}}.",
    "You saved {{r0.difference}}.",
    "You have {{r0.difference}} left to spend.",
    "The net difference is {{r0.difference}}, so you can afford another payment.",
    "Your spending fell compared with September.",
    "Your income is guaranteed next month.",
    "The payment was received by the beneficiary.",
    "These figures cover your complete bank statement.",
    "Expenses total ₦19,751.51.",
    "Your expenses were ₦19,751.50.",
    "Your expenses were 19751.51 naira.",
    "The source is https://invented.example/receipt.",
    "Income was {{r0.income}}. Your bank is connected.",
    "Income was {{r0.income}} and {{r0.limit0}}.",
    "{{r0.limit0}}..",
    "{{r99.income}}.",
    "{{r0.balance}}.",
  ])("rejects invented, relabeled or unproven claims: %s", (text) => {
    expect(() => acceptNarration(answer(text), [fact])).toThrow(NarrationError);
  });

  it("still requires all limitations even when the paraphrase is valid", () => {
    const text =
      "Your total spending was {{r0.expenses}} and your total income was {{r0.income}}.";
    for (const limit of narrationContract([fact]).required) {
      const otherLimits = narrationContract([fact])
        .required.filter((t) => t !== limit)
        .join(" ");
      expect(() =>
        acceptNarration(answer(text, otherLimits), [fact]),
      ).toThrowError("NARRATION_LIMIT");
    }
  });

  it.each([
    calc,
    search(),
    detail(),
    evidence(),
    step("get_account_summary", { accountIds: ["amina-current"] }),
  ])(
    "generates examples that satisfy their own contract: %#",
    async ({ call }) => {
      const s = setup(scripted());
      const parsed = ToolCallSchema.parse(call);
      const f = makeFact(
        parsed,
        await s.realTools.dispatch(s.input.ctx, parsed),
      ).fact;
      const contract = narrationContract([f]);
      expect(contract.examples.length).toBeGreaterThan(0);
      for (const example of contract.examples) {
        expect(example.resultId).toBe(f.resultId);
        expect(() =>
          acceptNarration(
            {
              paragraphs: [
                {
                  resultIds: [example.resultId],
                  text: `${example.text} ${contract.required.join(" ")}`.trim(),
                },
              ],
            },
            [f],
          ),
        ).not.toThrow();
      }
    },
  );

  it.each(["debit", "credit"] as const)(
    "keeps filtered differences scoped and comparisons sign-correct: %s",
    async (direction) => {
      const s = setup(scripted());
      const call = ToolCallSchema.parse({
        ...calc.call,
        args: { ...calc.call.args, direction },
      });
      const f = makeFact(
        call,
        await s.realTools.dispatch(s.input.ctx, call),
      ).fact;
      const output = (text: string) => ({
        paragraphs: [
          {
            resultIds: [f.resultId],
            text: `${text} ${narrationContract([f]).required.join(" ")}`,
          },
        ],
      });
      expect(
        acceptNarration(
          output("The filtered difference is {{r0.difference}}."),
          [f],
        )[0],
      ).toContain("filtered difference");
      expect(() =>
        acceptNarration(output("The net difference is {{r0.difference}}."), [
          f,
        ]),
      ).toThrow();
      const comparison = output(
        "Income exceeded expenses by {{r0.difference}} in these records.",
      );
      if (direction === "debit")
        expect(() => acceptNarration(comparison, [f])).toThrow();
      else expect(() => acceptNarration(comparison, [f])).not.toThrow();
    },
  );
  it("does not authorize an exceeded-income claim for a zero difference", async () => {
    const s = setup(scripted());
    const call = ToolCallSchema.parse({
      ...calc.call,
      args: { ...calc.call.args, category: "nonexistent-category" },
    });
    const f = makeFact(
      call,
      await s.realTools.dispatch(s.input.ctx, call),
    ).fact;
    expect(f.presentation.metrics[2].value).toBe("₦0.00");
    expect(() =>
      acceptNarration(
        {
          paragraphs: [
            {
              resultIds: [f.resultId],
              text: `Income exceeded expenses by {{r0.difference}} in these records. ${narrationContract([f]).required.join(" ")}`,
            },
          ],
        },
        [f],
      ),
    ).toThrow();
  });

  it.each([
    [
      "Your bank balance is {{r0.difference}}.",
      "unsupported_structure",
      ["text", "difference_slot", "period"],
    ],
    [
      "Expenses total ₦19,751.51.",
      "literal_value",
      ["text", "comma", "text", "period"],
    ],
    [
      "Income is {{r9.income}}.",
      "unknown_slot",
      ["text", "income_slot", "period"],
    ],
    ["Note: {{r0.limit0}}", "embedded_limit", ["text", "colon", "limit_slot"]],
  ])(
    "reports a safe failure category and token structure: %s",
    (text, category, expected) => {
      try {
        acceptNarration(answer(text as string), [fact]);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(NarrationError);
        expect((error as NarrationError).diagnostic).toMatchObject({
          version: 1,
          category,
          paragraphIndex: 0,
          clauseIndex: 0,
          structure: expected,
        });
      }
    },
  );

  it("never echoes rejected prose, private labels, numbers, URLs, credentials or unknown slot names in diagnostics", () => {
    for (const text of [
      "PRIVATE_NAME expenses are ₦97,531.42. api_key=sk-PRIVATE_MARKER https://private.example",
      "{{r0.PRIVATE_MARKER}}.",
      "toString",
    ]) {
      try {
        acceptNarration(answer(text), [fact]);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(NarrationError);
        const diagnostic = JSON.stringify((error as NarrationError).diagnostic);
        expect(diagnostic).not.toMatch(
          /PRIVATE|97|531|42|private\.example|sk-|toString/,
        );
        expect(
          (error as NarrationError).diagnostic.structure?.length,
        ).toBeLessThanOrEqual(24);
      }
    }
    expect(() =>
      acceptNarration({ secret: "sk-PRIVATE_MARKER" }, [fact]),
    ).toThrowError("NARRATION_SCHEMA");
  });

  it("keeps result references and slot provenance bound to the same sentence", () => {
    const another = {
      ...fact,
      resultId: "another-result",
      presentation: { ...fact.presentation, resultId: "another-result" },
    };
    expect(() =>
      acceptNarration(
        {
          paragraphs: [
            { resultIds: [fact.resultId], text: "Income was {{r1.income}}." },
          ],
        },
        [fact, another],
      ),
    ).toThrowError("NARRATION_REFERENCE");
    expect(() =>
      acceptNarration(
        {
          paragraphs: [
            {
              resultIds: [fact.resultId, another.resultId],
              text: "Your spending was {{r0.expenses}} and your income was {{r1.income}}.",
            },
          ],
        },
        [fact, another],
      ),
    ).toThrowError("NARRATION_CLAIM");
  });

  it("returns only safe diagnostics through the actual fallback reply", async () => {
    const respond = (
      _task: string,
      input: { results: { resultId: string }[] },
    ) => ({ kind: "respond", resultIds: input.results.map((r) => r.resultId) });
    const s = setup(
      scripted(financial, calc, respond, {
        narration: (
          _task: string,
          input: { facts: { resultId: string }[] },
        ) => ({
          paragraphs: [
            {
              resultIds: [input.facts[0].resultId],
              text: "PRIVATE_NAME balance is ₦97,531.42. api_key=sk-PRIVATE_MARKER",
            },
          ],
        }),
      }),
    );
    const reply = await s.agent().turn(s.input);
    expect(reply).toMatchObject({
      kind: "financial",
      presentation: { narration: "factual_fallback" },
      evidence: {
        narrationCode: "NARRATION_CLAIM",
        narrationDiagnostic: {
          category: "literal_value",
          paragraphIndex: 0,
          clauseIndex: 0,
        },
      },
    });
    expect(JSON.stringify(reply)).not.toMatch(/PRIVATE|97,531\.42|sk-/);
    expect(reply.text).toContain("₦19,751.51");
  });
});
