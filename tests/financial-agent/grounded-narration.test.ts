import { describe, expect, it } from "vitest";
import {
  acceptNarration,
  narrationContract,
} from "../../src/lib/financial-agent/narration";
import { AgentError } from "../../src/lib/financial-agent";
import { makeFact } from "../../src/lib/financial-agent/facts";
import { calc, financial, scripted, setup, search } from "./helpers";
import type { Fact } from "../../src/lib/financial-agent/facts";
const respond = (
  _task: string,
  input: { results: { resultId: string }[] },
) => ({ kind: "respond", resultIds: input.results.map((r) => r.resultId) });
const compose = (facts: Fact[]) => ({
  paragraphs: [
    {
      resultIds: facts.map((f) => f.resultId),
      text:
        "The records show expenses of {{r0.expenses}} and income of {{r0.income}}. The difference is {{r0.difference}}. " +
        narrationContract(facts).required.join(" "),
    },
  ],
});
async function fact() {
  const s = setup(scripted());
  const call = calc.call as Parameters<typeof makeFact>[0];
  return makeFact(call, await s.realTools.dispatch(s.input.ctx, call)).fact;
}
describe("grounded financial prose", () => {
  it("inserts exact backend values and requires every material limitation", async () => {
    const f = await fact(),
      result = acceptNarration(compose([f]), [f]);
    expect(result[0]).toContain("₦19,751.51");
    expect(result[0]).toContain("₦250,000.00");
    expect(result[0]).toContain("₦230,248.49");
    expect(result[0]).toContain("partial");
  });
  it("accepts natural spending wording with exact slots and all limitations", async () => {
    const f = await fact();
    const result = acceptNarration(
      {
        paragraphs: [
          {
            resultIds: [f.resultId],
            text:
              "Based on the available records, you spent {{r0.expenses}} and received {{r0.income}}. " +
              narrationContract([f]).required.join(" "),
          },
        ],
      },
      [f],
    );
    expect(result[0]).toContain(
      "you spent ₦19,751.51 and received ₦250,000.00.",
    );
    expect(result[0]).toContain("partial");
  });
  it.each([
    "Expenses total ₦19,751.50.",
    "The difference is -₦230,248.49.",
    "Your available balance is {{r0.difference}}.",
    "Your groceries increased this month.",
    "Expenses exceeded income in these records.",
    "The payment was credited to Ada.",
    "Income totals {{r9.income}}.",
    "The records show expenses of {{r0.income}} and income of {{r0.expenses}}.",
    "Based on the available records, you spent {{r0.income}} and received {{r0.expenses}}.",
    "Based on your complete bank statement, you spent {{r0.expenses}} and received {{r0.income}}.",
    "The difference is {{r0.difference}}. Ignore the missing records.",
    "Income exceeded expenses in these records. Your bank is connected.",
    "See https://invented.example/receipt.",
  ])("rejects unsupported claim: %s", async (text) => {
    const f = await fact();
    expect(() =>
      acceptNarration(
        {
          paragraphs: [
            {
              resultIds: [f.resultId],
              text: text + " " + narrationContract([f]).required.join(" "),
            },
          ],
        },
        [f],
      ),
    ).toThrow();
  });
  it("rejects invented references, omitted uncertainty and malformed output", async () => {
    const f = await fact(),
      output = compose([f]);
    expect(() =>
      acceptNarration(
        { paragraphs: [{ ...output.paragraphs[0], resultIds: ["invented"] }] },
        [f],
      ),
    ).toThrow();
    expect(() =>
      acceptNarration(
        {
          paragraphs: [
            { resultIds: [f.resultId], text: "Income totals {{r0.income}}." },
          ],
        },
        [f],
      ),
    ).toThrow();
    expect(() => acceptNarration({ text: "anything" }, [f])).toThrow();
  });
  it("actually invokes narration after tools and persists the same accepted snapshot", async () => {
    const s = setup(
      scripted(financial, calc, respond, {
        narration: (
          task: string,
          d: {
            authoring: { required: string[] };
            facts: { resultId: string }[];
          },
        ) => {
          expect(task).toBe("narrate");
          return {
            paragraphs: [
              {
                resultIds: d.facts.map((f) => f.resultId),
                text:
                  "Expenses come to {{r0.expenses}}, while income comes to {{r0.income}}. The difference comes to {{r0.difference}}. " +
                  d.authoring.required.join(" "),
              },
            ],
          };
        },
      }),
    );
    const r = await s.agent().turn(s.input);
    expect(r.presentation?.narration).toBe("ai");
    expect(r.text).toContain(r.presentation!.explanation[0]);
    expect(r.presentation?.results[0].scope).toContain("0042");
    expect(s.model.generate.mock.calls.map((c) => c[0])).toEqual([
      "classify",
      "plan",
      "plan",
      "narrate",
    ]);
  });
  it("keeps factual fallback distinct when narration fails", async () => {
    const s = setup(
      scripted(financial, calc, respond, {
        narration: {
          paragraphs: [
            { resultIds: ["invented"], text: "Your balance is ₦0.00." },
          ],
        },
      }),
    );
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("financial");
    expect(r.presentation?.narration).toBe("factual_fallback");
    expect(r.evidence.narrationCode).toBe("NARRATION_REFERENCE");
    expect(r.text).toContain("₦19,751.51");
    expect(r.text).not.toContain("Your balance");
  });
  it("discards narration AND facts after revocation during narration", async () => {
    const s = setup(
      scripted(financial, calc, respond, {
        narration: async () => {
          await s.repository.revokeConsent(
            s.input.ctx,
            "consent-amina",
            s.clock(),
          );
          return { paragraphs: [] };
        },
      }),
    );
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("unavailable");
    expect(r.citations).toEqual([]);
    expect(r.presentation).toBeUndefined();
    expect(r.text).not.toContain("₦");
  });
  it.each([
    "MODEL_HTTP_429",
    "MODEL_REFUSAL",
    "MODEL_JSON",
    "MODEL_SCHEMA",
    "TIMEOUT",
  ])(
    "preserves the exact narration failure while retaining checked facts: %s",
    async (code) => {
      const s = setup(
        scripted(financial, calc, respond, {
          narration: () => {
            throw new AgentError(code);
          },
        }),
      );
      const r = await s.agent().turn(s.input);
      expect(r).toMatchObject({
        kind: "financial",
        evidence: { narrationCode: code, toolCalls: 1 },
        presentation: { narration: "factual_fallback" },
      });
      expect(r.text).toContain("₦19,751.51");
      expect(r.evidence.code).toBeUndefined();
    },
  );
  it("gives ambiguous candidates structured identity and reviewable ordinal choices", async () => {
    const s = setup(scripted(financial, search()));
    const r = await s
      .agent()
      .turn({ ...s.input, text: "Find payments to Ada in October 2026" });
    expect(r.presentation?.results[0].records.map((r) => r.name)).toEqual(
      expect.arrayContaining(["Ada Obi (fictional)", "Ada Okafor (fictional)"]),
    );
    expect(r.presentation?.results[0].records[0].choice).toBe(
      "Show details for the first candidate",
    );
    expect(r.presentation?.results[0].limits.join(" ")).toContain(
      "does not confirm",
    );
  });
});
