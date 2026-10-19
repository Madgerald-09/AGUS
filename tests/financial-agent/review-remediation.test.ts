import { expect, it } from "vitest";
import { calculateIllustration } from "../../src/lib/financial-agent/reasoning";
import { resolveDateWindow } from "../../src/lib/financial-agent/date-window";
import { scripted, setup } from "./helpers";
const interest = {
  kind: "simple_interest" as const,
  principalNaira: "500",
  annualRatePercent: "10",
  months: 6,
};
it.each([
  "-₦500 at 10% annual simple interest for six months",
  "₦500 at 10% monthly simple interest for six months",
  "₦500 at 10 annual simple interest for six months",
  "$500 at 10% annual simple interest for six months",
  "₦500 at 10% annual simple interest for six years",
  "My rent is ₦500; principal is ₦200 at 10% annual simple interest for six months",
  "₦500 at 10% annual and 20% annual simple interest for six months",
])("rejects semantically unsupported operands: %s", (text) => {
  expect(() => calculateIllustration(interest, text)).toThrow();
});
it("uses the previous completed Monday–Sunday week", () => {
  expect(resolveDateWindow("last week", "2026-10-19T12:00:00Z")).toEqual({
    kind: "resolved",
    interval: {
      from: "2026-10-11T23:00:00.000Z",
      toExclusive: "2026-10-18T23:00:00.000Z",
    },
  });
});
it.each([
  "How much did I pay Musa last week?",
  "Find the payment I made to Musa.",
  "Show me transfers I sent yesterday.",
  "Did I pay that person already?",
])(
  "offers contextual accounts after payment misclassification: %s",
  async (text) => {
    const s = setup(scripted({ route: "payment_draft" }));
    const reply = await s.agent().turn({ ...s.input, text, accountIds: [] });
    expect(reply).toMatchObject({
      kind: "clarify",
      accountAction: "choose_demo_account",
    });
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it("does not source operands from unrelated historical statements", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "What is your savings goal?" },
      { safeGeneralConversation: true },
      { route: "financial_reasoning" },
      { text: "An illustration.", calculation: interest },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Suppose my rent is ₦500, income ₦10,000 and expenses last six months.",
  });
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Calculate simple interest at 10% annual.",
  });
  expect(reply.kind).toBe("clarify");
  expect(reply.text).not.toContain("₦25.00");
});

it.each([
  "₦500 at 10% annual simple interest for six months and six years",
  "₦500 at 10% annual monthly simple interest for six months",
  "Principal ₦500 with savings rate 10% annually for six months",
  "My rent is ₦500 at 10% annual simple interest for six months",
  "₦500.001 at 10% annual simple interest for six months",
  "negative ₦500 at 10% annual simple interest for six months",
  "₦500 at 10% annual simple interest for six months; principal ₦600",
])("clarifies conflicting or unsupported grammar: %s", (text) => {
  expect(() => calculateIllustration(interest, text)).toThrow();
});
it.each([
  ["₦500 at 10% annual simple interest for six months", "₦25.00"],
  [
    "Principal is 50000 kobo at 10 percent annual simple interest for 6 months",
    "₦25.00",
  ],
])("preserves valid interest: %s", (text, total) => {
  expect(calculateIllustration(interest, text)).toContain(total);
});
it("keeps identical values in distinct roles", () => {
  expect(
    calculateIllustration(
      {
        kind: "savings_total",
        incomeNaira: "6",
        savingsPercent: "6",
        months: 6,
      },
      "I earn ₦6 monthly and save 6% for six months",
    ),
  ).toContain("₦2.16");
  expect(() =>
    calculateIllustration(
      {
        kind: "savings_total",
        incomeNaira: "6",
        savingsPercent: "6",
        months: 6,
      },
      "I earn ₦6 monthly and spend 6% for six months",
    ),
  ).toThrow();
});
it.each([
  ["0.01", "50", 1, "₦0.01"],
  ["0.01", "49", 1, "₦0.00"],
  ["999999999999.99", "99.99", 1200, "₦1,199,879,999,999,988.00"],
])(
  "uses exact kobo and half-up rounding at %s",
  (incomeNaira, savingsPercent, months, total) => {
    expect(
      calculateIllustration(
        { kind: "savings_total", incomeNaira, savingsPercent, months },
        `I earn ₦${incomeNaira} monthly and save ${savingsPercent}% for ${months} months`,
      ),
    ).toContain(total);
  },
);
it("rejects model values beyond schema precision boundaries", () => {
  expect(() =>
    calculateIllustration(
      { ...interest, principalNaira: "1000000000000" },
      "Principal ₦1000000000000 at 10% annual for six months",
    ),
  ).toThrow();
});
it("does not assume zero starting savings over a supplied balance", () => {
  expect(() =>
    calculateIllustration(
      {
        kind: "savings_goal",
        monthlySavingsNaira: "500",
        targetNaira: "1000000",
        startingNaira: "0",
      },
      "I have ₦500 saved and earn ₦500 monthly, how long until millionaire?",
    ),
  ).toThrow();
});
it("links only explicitly referenced immediately preceding user figures", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "What would you like to calculate?" },
      { safeGeneralConversation: true },
      { route: "financial_reasoning" },
      { text: "Simple interest excludes compounding.", calculation: interest },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Suppose principal is ₦500 at 10% annual interest for six months.",
  });
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Using those figures, calculate simple interest.",
  });
  expect(reply.kind).toBe("general");
  expect(reply.text).toContain("₦25.00");
});
it.each([undefined, "0", "100"])(
  "clarifies missing model operands (%s)",
  async (principalNaira) => {
    const s = setup(
      scripted(
        { route: "financial_reasoning" },
        {
          text: "An illustration.",
          calculation: { ...interest, principalNaira },
        },
      ),
    );
    const reply = await s.agent().turn({
      ...s.input,
      accountIds: [],
      text: "Calculate simple interest at 10% annual for six months.",
    });
    expect(reply.kind).toBe("clarify");
  },
);
it("does not discard a supplied savings constraint in a goal illustration", () => {
  expect(() =>
    calculateIllustration(
      {
        kind: "savings_goal",
        monthlySavingsNaira: "500",
        targetNaira: "1000000",
        startingNaira: "0",
      },
      "If I earn ₦500 monthly and save 20%, when will I be a millionaire?",
    ),
  ).toThrow();
});
it.each([
  "Did I pay Musa? Send ₦500 to him.",
  "How much did I pay Musa last week and pay him again?",
  "Did I pay that person or prepare a new payment?",
])(
  "clarifies mixed or ambiguous historical/action intent: %s",
  async (text) => {
    const s = setup(scripted({ route: "payment_draft" }));
    const reply = await s.agent().turn({ ...s.input, text, accountIds: [] });
    expect(reply.kind).toBe("clarify");
    expect(reply.handoff).toBeUndefined();
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it("does not ground a negated monthly income", () => {
  expect(() =>
    calculateIllustration(
      {
        kind: "savings_goal",
        monthlySavingsNaira: "500",
        targetNaira: "1000000",
        startingNaira: "0",
      },
      "I don't earn ₦500 monthly. When will I become a millionaire?",
    ),
  ).toThrow();
});
it("does not search past an intervening unrelated user turn", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "Which scenario should we explore?" },
      { safeGeneralConversation: true },
      { route: "general" },
      { text: "Tell me more about your hobby." },
      { safeGeneralConversation: true },
      { route: "financial_reasoning" },
      { text: "Simple interest.", calculation: interest },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Suppose principal is ₦500 at 10% annual for six months.",
  });
  await s.agent().turn({ ...s.input, accountIds: [], text: "I enjoy chess." });
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Using those figures calculate simple interest.",
  });
  expect(reply.kind).toBe("clarify");
});
it("accepts an explicitly monthly savings percentage without treating it as interest", () => {
  expect(
    calculateIllustration(
      {
        kind: "savings_total",
        incomeNaira: "500",
        savingsPercent: "10",
        months: 6,
      },
      "I earn ₦500 monthly and save 10% monthly for six months",
    ),
  ).toContain("₦300.00");
});
