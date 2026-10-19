import { describe, expect, it, vi } from "vitest";
import { resolveDateWindow } from "../../src/lib/financial-agent/date-window";
import { ToolCallSchema } from "../../src/lib/financial-data/contracts";
import { calc, financial, scripted, search, setup } from "./helpers";

const october = {
  from: "2026-09-30T23:00:00.000Z",
  toExclusive: "2026-10-31T23:00:00.000Z",
};
const wrong = {
  from: "2026-10-01T00:00:00Z",
  toExclusive: "2026-11-01T00:00:00Z",
};
const totalsRequest =
  "Calculate my spending and income for amina-current for the full calendar month of October 2026, Africa/Lagos.";
const respond = (
  _task: string,
  input: { results: { resultId: string }[] },
) => ({
  kind: "respond",
  resultIds: input.results.map((r) => r.resultId),
});

describe("deterministic orchestration date windows", () => {
  it.each([
    ["last month", "2026-08-31T23:00:00.000Z", "2026-09-30T23:00:00.000Z"],
    ["this week", "2026-10-18T23:00:00.000Z", "2026-10-20T23:00:00.000Z"],
    ["yesterday", "2026-10-18T23:00:00.000Z", "2026-10-19T23:00:00.000Z"],
  ])(
    "resolves %s from the trusted Lagos calendar",
    (period, from, toExclusive) => {
      expect(
        resolveDateWindow(`Show my spending ${period}`, "2026-10-19T23:30:00Z"),
      ).toEqual({ kind: "resolved", interval: { from, toExclusive } });
    },
  );
  it.each([
    "October 2026",
    "for the full calendar month of October 2026, Africa/Lagos",
    "in Oct 2026 WAT",
    "Find payments to Ada in October 2026",
    "from 2026-10-01 to 2026-11-01 exclusive, Africa/Lagos",
  ])("resolves %s with the existing Lagos helper", (text) => {
    expect(resolveDateWindow(text)).toEqual({
      kind: "resolved",
      interval: october,
    });
  });

  it.each([
    ["December 2026", "2026-11-30T23:00:00.000Z", "2026-12-31T23:00:00.000Z"],
    ["February 2028", "2028-01-31T23:00:00.000Z", "2028-02-29T23:00:00.000Z"],
    ["on 2028-02-29", "2028-02-28T23:00:00.000Z", "2028-02-29T23:00:00.000Z"],
  ])("handles calendar rollover for %s", (text, from, toExclusive) => {
    expect(resolveDateWindow(text)).toEqual({
      kind: "resolved",
      interval: { from, toExclusive },
    });
  });

  it("reproduces the wrong total and corrects model UTC midnights before dispatch", async () => {
    const proposed = {
      ...calc,
      call: { ...calc.call, args: { ...calc.call.args, ...wrong } },
    };
    const s = setup(scripted(financial, proposed, respond));
    const raw = await s.realTools.dispatch(
      s.input.ctx,
      ToolCallSchema.parse(proposed.call),
    );
    expect(raw.data).toMatchObject({ expenseKobo: 2063939 });
    const result = await s.agent().turn({ ...s.input, text: totalsRequest });
    expect(s.tools.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ args: { ...calc.call.args, ...october } }),
    );
    expect(s.model.generate.mock.calls[1][1]).toMatchObject({
      dateWindow: october,
    });
    expect(result).toMatchObject({
      kind: "financial",
      evidence: { toolCalls: 1 },
    });
    expect(result.text).toContain("₦19,751.51");
    expect(result.text).toContain("₦250,000.00");
    expect(result.text).toContain("₦230,248.49");
    expect(result.text).toContain("Available records only");
    expect(result.text).toContain("SIMULATED FICTIONAL DATA");
    expect(result.citations).toHaveLength(1);
  });

  it.each([
    ["SYNTHETIC-october-midnight", "october-midnight", true],
    ["SYNTHETIC-november-midnight", "november-midnight", false],
  ])(
    "uses the same corrected window for boundary search %s",
    async (query, id, included) => {
      const proposed = search(query);
      proposed.call.args = { ...proposed.call.args, ...wrong };
      const s = setup(scripted(financial, proposed, respond));
      const result = await s.agent().turn({
        ...s.input,
        text: `Search October 2026 for exact reference ${query}`,
      });
      expect(s.tools.dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        expect.objectContaining({
          args: { ...proposed.call.args, ...october },
        }),
      );
      const raw = await vi.mocked(s.tools.dispatch).mock.results[0].value;
      expect(raw.data.matches.map((t: { id: string }) => t.id)).toEqual(
        included ? [id] : [],
      );
      expect(result.kind).toBe("financial");
      if (included) expect(result.text).toContain("₦1.00");
      else
        expect(result.text).toContain(
          "not proof that a payment never happened",
        );
    },
  );

  it.each([
    ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", wrong],
    [
      "2026-10-01T00:30:00+01:00",
      "2026-10-02T00:30:00+01:00",
      {
        from: "2026-09-30T23:30:00.000Z",
        toExclusive: "2026-10-01T23:30:00.000Z",
      },
    ],
  ])(
    "preserves an explicit timestamp window from %s to %s",
    async (from, to, interval) => {
      const proposed = {
        ...calc,
        call: { ...calc.call, args: { ...calc.call.args, ...wrong } },
      };
      const s = setup(scripted(financial, proposed, respond));
      const result = await s.agent().turn({
        ...s.input,
        text: `Calculate spending from ${from} to ${to} exclusive, Africa/Lagos.`,
      });
      expect(result.kind).toBe("financial");
      expect(s.tools.dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        expect.objectContaining({
          args: {
            ...calc.call.args,
            from: new Date(interval.from).toISOString(),
            toExclusive: new Date(interval.toExclusive).toISOString(),
          },
        }),
      );
      if (interval === wrong) expect(result.text).toContain("₦20,639.39");
    },
  );

  it.each([
    "October",
    "last Friday",
    "10/11/2026",
    "on 2026-02-30",
    "from 2026-10-01 to 2026-11-01",
    "October 2026 and November 2026",
    "first half of October 2026",
    "before October 2026",
    "October 2026 UTC",
    "October 2026 from 12:00 to 14:00",
    "on 2026-10-01T12:00:00",
    "from 2026-10-01T00:00:00Z to 2026-09-01T00:00:00Z",
    "from 2026-02-30T00:00:00Z to 2026-03-02T00:00:00Z",
    "from 2026-01-01 to 2028-01-01 exclusive",
    "October 2026-01",
    "from 2026-10-01T00:00:00Z to 2026-11-01T00:00:00Zjunk",
  ])(
    "clarifies ambiguous, unsupported or invalid dates without tools: %s",
    async (text) => {
      const s = setup(scripted(financial, calc, respond));
      const result = await s
        .agent()
        .turn({ ...s.input, text: `Check spending ${text}` });
      expect(result).toMatchObject({
        kind: "clarify",
        citations: [],
        evidence: { toolCalls: 0 },
      });
      expect(result.text).toContain("Which exact dates");
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    },
  );

  it("normalizes date-only input before privacy scrubbing and keeps other filters", async () => {
    const proposed = {
      ...calc,
      call: {
        ...calc.call,
        args: {
          ...calc.call.args,
          ...wrong,
          category: "food",
          groupBy: "category",
        },
      },
    };
    const s = setup(scripted(financial, proposed, respond));
    const result = await s.agent().turn({
      ...s.input,
      text: "Calculate food spending from 2026-10-01 to 2026-11-01 exclusive, Africa/Lagos",
    });
    expect(result.kind).toBe("financial");
    expect(s.tools.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ args: { ...proposed.call.args, ...october } }),
    );
  });

  it("accepts a UTC label on an explicit UTC timestamp window", () => {
    expect(
      resolveDateWindow(`from ${wrong.from} to ${wrong.toExclusive} UTC`),
    ).toEqual({
      kind: "resolved",
      interval: {
        from: new Date(wrong.from).toISOString(),
        toExclusive: new Date(wrong.toExclusive).toISOString(),
      },
    });
  });

  it.each(["The first one", "Show its evidence", "What is my balance?"])(
    "does not infer a date from a dateless request: %s",
    (text) => {
      expect(resolveDateWindow(text)).toEqual({ kind: "absent" });
    },
  );

  it("does not let model-invented dates authorize an interval read", async () => {
    const s = setup(scripted(financial, calc, respond));
    const result = await s
      .agent()
      .turn({ ...s.input, text: "Calculate my spending" });
    expect(result.kind).toBe("clarify");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
});
