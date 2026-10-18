import { describe, expect, it } from "vitest";
import {
  makeFact,
  literalLabel,
  money,
} from "../../src/lib/financial-agent/facts";
import { setup, scripted, financial, calc, detail, step } from "./helpers";
const respond = (
  _task: string,
  input: { results: { resultId: string }[] },
) => ({ kind: "respond", resultIds: input.results.map((r) => r.resultId) });
describe("financial fact rendering", () => {
  it("labels returned funds instead of ordinary income", async () => {
    const s = setup(scripted(financial, detail("return-oct"), respond));
    const r = await s.agent().turn(s.input);
    expect(r.text).toContain("Returned funds linked to reversed-oct");
    expect(r.text).toContain("excluded from ordinary income");
  });
  it("renders filtered totals and groups without implying full cashflow", async () => {
    const s = setup(
      scripted(
        financial,
        {
          ...calc,
          call: {
            ...calc.call,
            args: {
              ...calc.call.args,
              groupBy: "category",
              category: "food",
              direction: "debit",
            },
          },
        },
        respond,
      ),
    );
    const r = await s.agent().turn(s.input);
    expect(r.text).toContain('category "food"');
    expect(r.text).toContain("filtered difference");
    expect(r.text).toContain('"food": expenses ₦1,250.50');
    expect(r.text).not.toContain("net ₦");
  });
  it("escapes literal provider labels without promoting them to financial narration", async () => {
    const s = setup(scripted(financial, detail(), respond), (d) => {
      d.transactions[0].counterparty.displayName =
        "<b>[fake](https://evil.example)</b>";
    });
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("financial");
    expect(r.text).toContain("untrusted literal");
    expect(r.text).not.toContain("<b>");
    expect(r.text).not.toContain("https://evil.example");
    expect(literalLabel("[x](/private)")).toContain("\\[");
  });
  it("formats signed kobo exactly without floating-point money arithmetic", () => {
    expect(money(1)).toBe("₦0.01");
    expect(money(-1)).toBe("-₦0.01");
    expect(money(Number.MAX_SAFE_INTEGER)).toBe("₦90,071,992,547,409.91");
    expect(money(null)).toBe("unavailable");
  });
  it("requires a source for a successful financial result", async () => {
    const s = setup(scripted());
    const call = calc.call as Parameters<typeof makeFact>[0];
    const result = await s.realTools.dispatch(s.input.ctx, call);
    expect(() =>
      makeFact(call, {
        ...result,
        meta: { ...result.meta, sources: [], simulated: false },
      }),
    ).toThrow();
  });
  it("does not infer implied permission scopes", async () => {
    const s = setup(
      scripted(
        financial,
        step("get_account_summary", { accountIds: ["amina-current"] }),
      ),
      (d) => {
        d.consents[0].scopes = ["transactions:read"];
      },
    );
    expect((await s.agent().turn(s.input)).kind).toBe("unavailable");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
  it("uses trusted time for consent expiry", async () => {
    const s = setup(scripted(financial));
    s.setNow("2027-01-01T00:00:00.000Z");
    expect((await s.agent().turn(s.input)).kind).toBe("unavailable");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
  it("requires explicit account scope when multiple accounts are injected", async () => {
    const s = setup(scripted(financial));
    const r = await s
      .agent()
      .turn({ ...s.input, accountIds: ["amina-current", "amina-savings"] });
    expect(r.kind).toBe("clarify");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
});
