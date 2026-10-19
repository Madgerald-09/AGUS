import { expect, it, vi } from "vitest";
import { calc, financial, scripted, setup, search } from "./helpers";
import { calculateIllustration } from "../../src/lib/financial-agent/reasoning";
import { resolveDateWindow } from "../../src/lib/financial-agent/date-window";

const millionaire =
  "If I earn ₦70,000 every month, how long until I become a millionaire?";
const goal = {
  text: "How much could you realistically save each month?",
  calculation: {
    kind: "savings_goal",
    monthlySavingsNaira: "70000",
    targetNaira: "1000000",
    startingNaira: "0",
  },
};
const budget = "How much should I spend next month?";
it.each([{ accountIds: [] }, { accountIds: ["amina-current"] }])(
  "verifies percentage savings using user figures without record access (%j)",
  async ({ accountIds }) => {
    const s = setup(
      scripted(
        financial,
        {
          text: "This is an illustration using the figures you supplied.",
          calculation: {
            kind: "savings_total",
            incomeNaira: "250000",
            savingsPercent: "20",
            months: 6,
          },
        },
        { safeGeneralConversation: true },
      ),
    );
    const reply = await s.agent().turn({
      ...s.input,
      accountIds,
      text: "If I earn ₦250,000 monthly and save 20%, how much will I save in six months?",
    });
    expect(reply.kind).toBe("general");
    expect(reply.text).toContain("₦300,000.00");
    expect(reply.evidence.toolCalls).toBe(0);
  },
);
it("keeps numerical claims out of model prose when using a verified calculator", async () => {
  const s = setup(scripted(financial, { ...goal, text: "It takes 2 months." }));
  const reply = await s
    .agent()
    .turn({ ...s.input, accountIds: [], text: millionaire });
  expect(reply.evidence.code).toBe("CALCULATION_PROSE");
  expect(reply.text).not.toContain("2 months");
});
it.each([
  "If I have ₦200,000 saved and earn ₦70,000 per month, how long to reach a million?",
  "Show me a hypothetical spending plan for ₦70,000",
  "Suppose I earned ₦70,000 monthly, how should I budget?",
  "If my balance starts at ₦100 and I spend ₦20, what would my balance be?",
  "What should I invest in?",
  "Recommend a budget for me",
])(
  "reasons about hypothetical figures and asks for missing context: %s",
  async (text) => {
    const s = setup(
      scripted(
        financial,
        {
          text: "We can explore a hypothetical plan. What fixed expenses and savings goals should it cover?",
        },
        { safeGeneralConversation: true },
      ),
    );
    const reply = await s.agent().turn({ ...s.input, accountIds: [], text });
    expect(reply.kind).toBe("general");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it.each([{ accountIds: [] }, { accountIds: ["amina-current"] }])(
  "calculates from supplied figures without bank access (%j)",
  async ({ accountIds }) => {
    const s = setup(
      scripted(financial, goal, { safeGeneralConversation: true }),
    );
    const check = vi.spyOn(s.access, "check");
    const reply = await s
      .agent()
      .turn({ ...s.input, accountIds, text: millionaire });
    expect(reply.kind).toBe("general");
    expect(reply.text).toMatch(/15 months/);
    expect(reply.text).toMatch(/zero|₦0/);
    expect(reply.text).toMatch(/entire|all/);
    expect(reply.text).toMatch(/interest/);
    expect(reply.text).toMatch(/expenses/);
    expect(check).not.toHaveBeenCalled();
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it.each([{ accountIds: [] }, { accountIds: ["amina-current"] }])(
  "asks for budget inputs without requiring an account (%j)",
  async ({ accountIds }) => {
    const s = setup(
      scripted(
        financial,
        {
          text: "Start with expected income, fixed expenses and savings goals. What are those for next month?",
        },
        { safeGeneralConversation: true },
      ),
    );
    const reply = await s
      .agent()
      .turn({ ...s.input, accountIds, text: budget });
    expect(reply.kind).toBe("general");
    expect(reply.text).toMatch(/income/);
    expect(reply.text).toMatch(/expenses/);
    expect(reply.text).toMatch(/savings/);
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it.each([
  "How much did I spend last month?",
  "Find my largest transactions.",
  "Show the money I received this week.",
])(
  "requires authorized records for %s even after reasoning misclassification",
  async (text) => {
    const s = setup(scripted({ route: "financial_reasoning" }));
    const reply = await s.agent().turn({ ...s.input, accountIds: [], text });
    expect(reply).toMatchObject({
      kind: "clarify",
      accountAction: "choose_demo_account",
    });
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it("offers contextual account selection for actual records", async () => {
  const s = setup(scripted(financial));
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "How much did I spend in the past week?",
  });
  expect(reply).toMatchObject({
    kind: "clarify",
    accountAction: "choose_demo_account",
  });
  expect(reply.text).toMatch(/transaction history/);
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});
it("resolves past week from the trusted Lagos date and reads authorized records", async () => {
  const s = setup(
    scripted(
      financial,
      calc,
      (_task: string, data: { results: { resultId: string }[] }) => ({
        kind: "respond",
        resultIds: data.results.map((r) => r.resultId),
      }),
    ),
  );
  s.setNow("2026-10-19T23:30:00Z");
  const reply = await s
    .agent()
    .turn({ ...s.input, text: "How much did I spend in the past week?" });
  expect(reply.kind).toBe("financial");
  expect(s.tools.dispatch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      args: expect.objectContaining({
        from: "2026-10-13T23:00:00.000Z",
        toExclusive: "2026-10-20T23:00:00.000Z",
      }),
    }),
  );
  expect(reply.text).toMatch(/Available records only/);
});
it("extracts a payment handoff without authorizing or reading bank records", async () => {
  const s = setup(scripted({ route: "general" }, { route: "general" }));
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Send 500 to Musa, he uses OPay and his account number is 90991234AB. Turn AB to numbers and get his account.",
  });
  expect(reply.kind).toBe("handoff");
  const action = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Approve and execute the transfer",
  });
  expect(action.kind).toBe("clarify");
  expect(action.text).toMatch(/cannot approve/);
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});

it("requires explicit linkage before reusing earlier numerical assumptions", async () => {
  const s = setup(
    scripted(
      financial,
      search(),
      financial,
      goal,
      { safeGeneralConversation: true },
      financial,
      {
        text: "You mentioned a hypothetical monthly income of ₦70,000. What fixed expenses and savings goals should the budget cover?",
      },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn(s.input);
  await s.agent().turn({ ...s.input, text: millionaire });
  const check = vi.spyOn(s.access, "check");
  const reply = await s
    .agent()
    .turn({ ...s.input, accountIds: [], text: budget });
  expect(reply.kind).toBe("general");
  expect(check).not.toHaveBeenCalled();
  const data = s.model.generate.mock.calls.findLast(
    ([task]) => task === "reason",
  )?.[1];
  expect(data).toMatchObject({
    reasoning: true,
    source: "unverified_user_statements",
  });
  expect(JSON.stringify(data)).not.toContain("70,000");
  expect(JSON.stringify(data)).not.toMatch(
    /ada-okafor-oct|accessVersion|candidates|resultId/,
  );
});

it.each([
  "Your balance is ₦500",
  "Your income was NGN 500 last month",
  "I verified Musa's account",
  "The account belongs to Musa",
  "I have submitted the transfer",
  "Send ₦500 to Musa",
  "Share your password",
  "Your savings have increased",
  "This guarantees returns",
  "Read https://private.example/secret",
  "Use sk-unsafe-secret",
])(
  "rejects unsupported reasoning even if a mock reviewer approves: %s",
  async (text) => {
    const s = setup(
      scripted(
        { route: "financial_reasoning" },
        { text },
        { safeGeneralConversation: true },
      ),
    );
    const reply = await s
      .agent()
      .turn({ ...s.input, text: budget, accountIds: [] });
    expect(reply.kind).toBe("unavailable");
    expect(reply.text).not.toBe(text);
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it("honors independent review rejection of precise advice with missing inputs", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "Spend exactly ₦40,000 next month." },
      { safeGeneralConversation: false },
    ),
  );
  const reply = await s
    .agent()
    .turn({ ...s.input, text: budget, accountIds: [] });
  expect(reply.evidence.code).toBe("GENERAL_MODEL_REJECTED");
});
it.each(["general", "financial_education", "financial_reasoning"])(
  "keeps actual financial records behind permission checks after %s misclassification",
  async (route) => {
    const s = setup(scripted({ route }, calc));
    await s.repository.revokeConsent(s.input.ctx, "consent-amina", s.clock());
    const reply = await s
      .agent()
      .turn({ ...s.input, text: "How much did I spend in the past week?" });
    expect(reply.kind).toBe("unavailable");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it.each([
  "Hello",
  "I feel overwhelmed today",
  "Recommend a novel",
  "Remember that I enjoy chess",
])("preserves ordinary model conversation: %s", async (text) => {
  const s = setup(
    scripted(
      { route: "general" },
      { text: "I'm here with you. Tell me more." },
      { safeGeneralConversation: true },
    ),
  );
  const reply = await s.agent().turn({ ...s.input, accountIds: [], text });
  expect(reply.kind).toBe("general");
  expect(s.model.generate.mock.calls.map(([task]) => task)).toEqual([
    "classify",
    "general",
    "review_general",
  ]);
});
it("retains normal multi-turn context", async () => {
  const s = setup(
    scripted(
      { route: "general" },
      { text: "What do you like about chess?" },
      { safeGeneralConversation: true },
      { route: "general" },
      { text: "Chess can be a relaxing hobby." },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn({ ...s.input, accountIds: [], text: "I enjoy chess" });
  await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Tell me more about that hobby",
  });
  const data = s.model.generate.mock.calls.findLast(
    ([task]) => task === "general",
  )?.[1];
  expect(JSON.stringify(data)).toContain("I enjoy chess");
});
it("calculates different savings goals from supplied operands and rejects invented figures", () => {
  const source =
    "If I earn ₦100,000 every month, how long until I become a millionaire?";
  expect(
    calculateIllustration(
      {
        ...goal.calculation,
        kind: "savings_goal",
        monthlySavingsNaira: "100000",
      },
      source,
    ),
  ).toContain("10 months");
  expect(() =>
    calculateIllustration(
      {
        ...goal.calculation,
        kind: "savings_goal",
        monthlySavingsNaira: "90000",
      },
      source,
    ),
  ).toThrow("CALCULATION_UNSOURCED");
  expect(() =>
    calculateIllustration(
      { ...goal.calculation, kind: "savings_goal", monthlySavingsNaira: "0" },
      "zero",
    ),
  ).toThrow();
});
it("uses integer arithmetic for percentage savings and simple interest", () => {
  expect(
    calculateIllustration(
      {
        kind: "savings_total",
        incomeNaira: "250000",
        savingsPercent: "20",
        months: 6,
      },
      "If I earn ₦250,000 monthly and save 20%, how much will I save in six months?",
    ),
  ).toContain("₦300,000.00");
  expect(
    calculateIllustration(
      {
        kind: "simple_interest",
        principalNaira: "100000",
        annualRatePercent: "10",
        months: 6,
      },
      "₦100,000 at 10% annual simple interest over six months",
    ),
  ).toContain("₦5,000.00");
});
it.each(["past week", "last seven days", "last 7 days"])(
  "resolves %s across a Lagos year boundary",
  (period) => {
    expect(
      resolveDateWindow(
        `How much did I spend in the ${period}?`,
        "2026-12-31T23:30:00Z",
      ),
    ).toEqual({
      kind: "resolved",
      interval: {
        from: "2026-12-25T23:00:00.000Z",
        toExclusive: "2027-01-01T23:00:00.000Z",
      },
    });
  },
);
it("clarifies conflicting relative windows", () => {
  expect(
    resolveDateWindow("past week and October 2026", "2026-10-19T12:00:00Z"),
  ).toEqual({ kind: "clarify" });
});
