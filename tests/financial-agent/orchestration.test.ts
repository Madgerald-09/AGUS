import { describe, expect, it } from "vitest";
import {
  createFinancialAgent,
  MemoryContextStore,
  PRODUCT_KNOWLEDGE,
} from "../../src/lib/financial-agent";
import { fixtureOtherPrincipal } from "../../src/lib/financial-data";
import {
  setup,
  scripted,
  financial,
  calc,
  search,
  detail,
  evidence,
  step,
} from "./helpers";

describe("isolated routing and genuine-model protocol (scripted transport in unit tests)", () => {
  it.each([
    ["Hello!", "Hi! How has your day been?"],
    [
      "Please retry explaining photosynthesis",
      "Plants use sunlight to make sugars.",
    ],
    ["Send a letter to Ada", "Dear Ada, I hope you are having a lovely day."],
    [
      "How do birds execute coordinated turns?",
      "Birds adjust their wings and respond to their neighbors.",
    ],
    [
      "I had a difficult day",
      "That sounds draining. What was the hardest part?",
    ],
    [
      "Give me a short story",
      "A small bird found a blue ribbon and built a nest around it.",
    ],
    [
      "Explain photosynthesis",
      "Plants use sunlight to turn water and carbon dioxide into sugars.",
    ],
  ])("allows natural general conversation: %s", async (text, answer) => {
    const model = scripted(
      { route: "general" },
      { text: answer },
      { safeGeneralConversation: true },
    );
    const s = setup(model);
    const r = await s.agent().turn({ ...s.input, text });
    expect(r).toMatchObject({ kind: "general", text: answer, citations: [] });
    expect(r.evidence.modelCalls).toBe(3);
    expect(s.tools.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(model.generate.mock.calls)).not.toContain("tenantId");
  });
  it.each([
    ["product", "Does AGUS provide verified Wema or Mono account connections?"],
    ["product", "Does AGUS have real bank connections?"],
    ["general", "Can AGUS link a Mono account?"],
    ["general", "Are Wema connections supported by AGUS?"],
  ])("grounds product selection after route %s: %s", async (route, text) => {
    const model = scripted({ route }, { topic: "data" });
    const s = setup(model);
    const r = await s.agent().turn({ ...s.input, accountIds: [], text });
    expect(model.generate.mock.calls[1]).toEqual([
      "product",
      { text, knowledge: PRODUCT_KNOWLEDGE },
      expect.any(AbortSignal),
    ]);
    expect(r.kind).toBe("product");
    expect(r.text).toContain("fictional");
    expect(r.text).toContain("agus-product-v1.0.0");
    expect(r.text).toContain(
      "Wema and Mono account connections are not verified or supplied by this module.",
    );
    expect(r.evidence).toMatchObject({ modelCalls: 2, toolCalls: 0 });
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
  it("does not invent unsupported product terms", async () => {
    const s = setup(scripted({ route: "product" }, { topic: "unknown" }));
    const r = await s.agent().turn({
      ...s.input,
      text: "What guaranteed interest rate does AGUS offer?",
    });
    expect(r.text).toContain("does not establish that capability");
  });
  it.each(["Send 500 to Ada", "Prepare a payment to Ada"])(
    "returns draft handoff without invoking payments: %s",
    async (text) => {
      const s = setup(scripted({ route: "general" }));
      const r = await s.agent().turn({ ...s.input, text });
      expect(r).toMatchObject({
        kind: "handoff",
        handoff: { kind: "existing_payment_draft" },
      });
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "Approve the transfer",
    "Submit my payment",
    "Retry transfer",
    "Use this OTP",
  ])("refuses chat execution: %s", async (text) => {
    const s = setup(scripted({ route: "general" }));
    expect((await s.agent().turn({ ...s.input, text })).kind).toBe("clarify");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
  it("forces misclassified financial requests through grounded reads", async () => {
    const s = setup(scripted({ route: "general" }, calc));
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("unavailable"); // exhausted scripted model is never treated as successful inference
    expect(s.tools.dispatch).toHaveBeenCalledTimes(1);
    expect(r.text).not.toContain("₦");
  });
  it("renders authoritative all-page totals from current tool facts", async () => {
    const s = setup(
      scripted(
        financial,
        calc,
        (_task: string, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: [input.results[0].resultId],
        }),
      ),
    );
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("financial");
    expect(r.text).toContain("₦19,751.51");
    expect(r.text).toContain("₦250,000.00");
    expect(r.text).toContain("₦230,248.49");
    expect(r.text).toContain("Available records only");
    expect(r.text).toContain("SIMULATED FICTIONAL DATA");
    expect(r.citations).toHaveLength(1);
  });
  it("supports bounded search/detail/evidence planning", async () => {
    const s = setup(
      scripted(
        financial,
        search("SYNTHETIC-ada-okafor-oct"),
        detail(),
        evidence(),
        (_task: string, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: input.results.map((r) => r.resultId),
        }),
      ),
    );
    const r = await s.agent().turn({
      ...s.input,
      text: "Find Ada Okafor October 2026 transaction and its evidence",
    });
    expect(r.kind).toBe("financial");
    expect(r.evidence.toolCalls).toBe(3);
    expect(r.citations).toHaveLength(3);
    expect(r.text).toContain("Fictional synthetic evidence");
    expect(r.text).toContain("does not establish recipient bank credit");
  });
  it("keeps ambiguity even when just one candidate is displayed", async () => {
    const s = setup(scripted(financial, search("Ada", 1)));
    const r = await s.agent().turn(s.input);
    expect(r.kind).toBe("clarify");
    expect(r.text).toContain("2 candidate");
    expect(r.text).toContain("Which candidate");
    expect(r.evidence.toolCalls).toBe(1);
  });
  it("persists candidate choices across a new agent instance and re-reads before evidence", async () => {
    const s = setup(
      scripted(
        financial,
        search(),
        financial,
        detail(),
        evidence(),
        (_t: string, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: input.results.map((r) => r.resultId),
        }),
      ),
    );
    expect((await s.agent().turn(s.input)).kind).toBe("clarify");
    const r = await createFinancialAgent(s.options).turn({
      ...s.input,
      text: "The smaller one; show its evidence",
    });
    expect(r.kind).toBe("financial");
    expect(r.text).toContain("ada-okafor-oct");
    expect(r.evidence.toolCalls).toBe(2);
  });
  it.each(["about 50k", "last Friday"])(
    "asks for explicit scope on %s",
    async (text) => {
      const s = setup(scripted(financial));
      const r = await s.agent().turn({ ...s.input, text });
      expect(r.kind).toBe("clarify");
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    },
  );
  it("asks for a missing authorized account", async () => {
    const s = setup(scripted(financial));
    const r = await s.agent().turn({ ...s.input, accountIds: [] });
    expect(r.kind).toBe("clarify");
  });
  it("reports no results without asserting payment absence", async () => {
    const s = setup(scripted(financial, search("nonexistent person")));
    const r = await s.agent().turn(s.input);
    expect(r.text).toContain("not proof that a payment never happened");
  });
  it("retains missing evidence and balances as unavailable", async () => {
    const s = setup(
      scripted(
        financial,
        detail("ada-obi-oct"),
        evidence("ada-obi-oct"),
        (_t: string, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: [input.results[1].resultId],
        }),
      ),
    );
    const r = await s.agent().turn(s.input);
    expect(r.text).toContain("No evidence is available");
    const b = setup(
      scripted(
        financial,
        step("get_account_summary", { accountIds: ["amina-savings"] }),
        (_t: string, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: [input.results[0].resultId],
        }),
      ),
    );
    const balance = await b.agent().turn({
      ...b.input,
      accountIds: ["amina-savings"],
      text: "What is my balance?",
    });
    expect(balance.text).toContain("available balance unavailable");
    expect(balance.text).not.toContain("₦0.00");
  });
  it("does not route a greeting into a prior financial selection", async () => {
    const s = setup(
      scripted(
        financial,
        search(),
        { route: "general" },
        { text: "Hello again!" },
        { safeGeneralConversation: true },
      ),
    );
    await s.agent().turn(s.input);
    const r = await s.agent().turn({ ...s.input, text: "Hello" });
    expect(r.kind).toBe("general");
  });
  it("isolates contexts by tenant/actor/conversation", async () => {
    const s = setup(
      scripted(
        financial,
        search(),
        { route: "general" },
        { text: "Hello!" },
        { safeGeneralConversation: true },
      ),
    );
    await s.agent().turn(s.input);
    const nextTurn = s.model.generate.mock.calls.length;
    const other = await s.agent().turn({
      ...s.input,
      ctx: fixtureOtherPrincipal,
      accountIds: ["tunde-current"],
      text: "Hello",
    });
    expect(other.kind).toBe("general");
    const prompts = JSON.stringify(s.model.generate.mock.calls.slice(nextTurn));
    expect(prompts).not.toContain("ada-okafor-oct");
  });
  it("supports a separately injected empty store", async () => {
    const s = setup(
      scripted(
        { route: "general" },
        { text: "Hi!" },
        { safeGeneralConversation: true },
      ),
    );
    s.options.store = new MemoryContextStore();
    expect((await s.agent().turn({ ...s.input, text: "Hi" })).kind).toBe(
      "general",
    );
  });
});
