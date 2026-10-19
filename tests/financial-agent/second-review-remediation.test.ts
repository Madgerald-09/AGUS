import { describe, expect, it } from "vitest";
import { calculateIllustration } from "../../src/lib/financial-agent/reasoning";
import {
  historicalReadIntent,
  paymentIntent,
} from "../../src/lib/financial-agent/protocol";
import { scripted, search, setup } from "./helpers";

const interest = {
  kind: "simple_interest" as const,
  principalNaira: "500",
  annualRatePercent: "10",
  months: 6,
};
const savings = {
  kind: "savings_total" as const,
  incomeNaira: "500",
  savingsPercent: "10",
  months: 6,
};

it.each([
  "Principal ₦500 at 10% annual for 6% months",
  "Principal ₦500 at 10% annual for six months; principal 6 months",
  "Principal ₦500 at 10% annual for six months; principal 10% annual",
  "Principal ₦500 at 10% annual for 6 percent months",
  "Principal ₦500 at 10% annual for ₦6 months",
  "Principal ₦500 at 10% annual for 6 naira months",
  "Principal ₦500 at 10% annual for 600 kobo months",
  "Principal ₦500 at 10% annual for six months; actually use 20% instead",
  "Principal ₦500 at 10% annual for six months; use 20%",
  "Principal ₦500 at 10% annual for six months; actually use twenty percent instead",
  "Principal ₦500 at 10% annual for six months; change the rate to 1e2%",
  "Principal ₦500 at 10% annual for six months and 20% interest",
  "Principal ₦500 at 10% monthly for six months",
  "Principal ₦500 at ₦10% annual for six months",
  "Principal ₦500 at 10 naira% annual for six months",
  "Principal ₦500 at 10% annual for six months; 99",
  "Principal ₦500 at 10% annual for six months; use 1e3 instead",
  "Principal ₦500 at 10% annual for six months; starting savings ₦100",
])(
  "rejects unsupported units, unused figures and unresolved corrections: %s",
  (source) => {
    expect(() => calculateIllustration(interest, source)).toThrow();
  },
);
it.each([
  "I earn ₦500 monthly and save 10% for six months; actually use ₦600 income instead",
  "I earn ₦500 monthly and save 10% for six months; actually save 20% instead",
  "I earn ₦500 monthly and save 10% for six months; actually use nine months instead",
  "I earn ₦500 monthly and save 10% for six months; use 9 instead",
  "I earn ₦500 monthly and save ₦10% for six months",
  "I earn ₦500 monthly and save 10% naira for six months",
  "I earn 500% monthly and save 10% for six months",
])(
  "clarifies income, savings, duration corrections and role collisions: %s",
  (source) => {
    expect(() => calculateIllustration(savings, source)).toThrow();
  },
);
it.each(["six months", "6 months", "6-month"])(
  "preserves a valid duration %s",
  (duration) => {
    expect(
      calculateIllustration(
        interest,
        `Principal ₦500 at 10% annual for ${duration}`,
      ),
    ).toContain("₦25.00");
  },
);
it("preserves savings totals and goals", () => {
  expect(
    calculateIllustration(
      savings,
      "I earn ₦500 monthly and save 10% for six months",
    ),
  ).toContain("₦300.00");
  expect(
    calculateIllustration(
      {
        kind: "savings_goal",
        monthlySavingsNaira: "500",
        targetNaira: "1000",
        startingNaira: "0",
      },
      "I save ₦500 monthly; target ₦1000",
    ),
  ).toContain("2 months");
});
it("never accepts the stale rate even if the model ignores the correction", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "An illustration.", calculation: interest },
    ),
  );
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Calculate simple interest on ₦500 at 10% annual for six months; actually use 20% instead.",
  });
  expect(reply.kind).toBe("clarify");
  expect(reply.text).not.toContain("₦25.00");
});

const questions = [
  "Did I transfer money to Musa last week?",
  "Did I make a transfer to Musa last week?",
  "Have I made a payment to Musa last week?",
  "Was the payment sent to Musa last week?",
  "Has Musa been paid last week?",
  "Was Musa paid last week?",
  "Did I send money to Musa last week?",
  "Have I transferred ₦500 to Musa last week?",
  "Have I sent Musa money last week?",
  "Can you check whether I transferred money to Musa last week?",
  "Can you check whether I have transferred money to Musa last week?",
  "Could you check if Musa was paid last week?",
  "Please check whether I sent Musa ₦500 yesterday.",
  "Did we transfer money to Musa last week?",
  "Were Musa and Ada paid last week?",
  "Check the transfer I made to Musa last week.",
];
const respond = (
  _task: string,
  input: { results: { resultId: string }[] },
) => ({ kind: "respond", resultIds: input.results.map((r) => r.resultId) });
describe.each(["payment_draft", "payment_action", "financial_read"])(
  "historical questions classified as %s",
  (route) => {
    it.each(questions)(
      "offers contextual account selection: %s",
      async (text) => {
        const s = setup(scripted({ route }));
        const reply = await s
          .agent()
          .turn({ ...s.input, text, accountIds: [] });
        expect(reply).toMatchObject({
          kind: "clarify",
          accountAction: "choose_demo_account",
        });
        expect(reply.handoff).toBeUndefined();
        expect(s.tools.dispatch).not.toHaveBeenCalled();
      },
    );
    it.each(questions)(
      "uses permission-checked reads with an account: %s",
      async (text) => {
        const s = setup(scripted({ route }, search("Musa"), respond));
        const reply = await s.agent().turn({ ...s.input, text });
        expect(reply.kind).toBe("financial");
        expect(reply.handoff).toBeUndefined();
        expect(reply.evidence.toolCalls).toBe(1);
        expect(reply.text).toContain("SIMULATED FICTIONAL DATA");
      },
    );
  },
);
it.each([
  "Did I transfer money to Musa last week? Send ₦500 to him now.",
  "Send ₦500 to Musa, then check whether I paid him last week.",
  "Prepare a payment to Musa. Was he paid last week?",
  "Was Musa paid last week? Prepare a new payment to him.",
  "Can you check whether I transferred money and pay him again?",
  "Have I transferred money to Musa? If not, transfer ₦500.",
  "Did I send money to Musa; do not send another payment.",
  "Was Musa paid last week? https://example.test/send/500",
  "Check the transfer I made to Musa and draft another payment.",
])(
  "clarifies mixed intent using the original instruction: %s",
  async (text) => {
    const s = setup(scripted({ route: "payment_draft" }));
    const reply = await s.agent().turn({ ...s.input, text, accountIds: [] });
    expect(reply.kind).toBe("clarify");
    expect(reply.accountAction).toBeUndefined();
    expect(reply.handoff).toBeUndefined();
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  },
);
it.each([
  "Send ₦500 to Musa.",
  "Pay Musa ₦500 now.",
  "Prepare a new transfer to Musa.",
  "Transfer ₦500 to Musa.",
])("preserves new payment instructions: %s", async (text) => {
  expect(historicalReadIntent(text)).toBe(false);
  const s = setup(scripted({ route: "payment_draft" }));
  expect(
    (await s.agent().turn({ ...s.input, text, accountIds: [] })).kind,
  ).toBe("handoff");
});
it("historical recognition is never payment authorization", () => {
  for (const text of questions) expect(paymentIntent(text)).toBeNull();
});
it("resumes the exact question after selection and still enforces owner isolation", async () => {
  const text = questions[0];
  const s = setup(
    scripted(
      { route: "payment_draft" },
      { route: "payment_draft" },
      search("Musa"),
      respond,
    ),
  );
  expect(
    (await s.agent().turn({ ...s.input, text, accountIds: [] })).accountAction,
  ).toBe("choose_demo_account");
  expect((await s.agent().turn({ ...s.input, text })).kind).toBe("financial");
  const bad = setup(
    scripted({ route: "payment_draft" }, search("Musa"), respond),
  );
  const reply = await bad
    .agent()
    .turn({ ...bad.input, text, accountIds: ["tunde-current"] });
  expect(reply.handoff).toBeUndefined();
  expect(bad.tools.dispatch).not.toHaveBeenCalled();
});

it.each([{ ...interest, annualRatePercent: "20" }, interest])(
  "requires clarification of the corrected rate even when proposed as %j",
  (calculation) => {
    expect(() =>
      calculateIllustration(
        calculation,
        "Principal ₦500 at 10% annual for six months; actually use 20% instead",
      ),
    ).toThrow();
  },
);
it("checks the original calculation instruction when scrubbing hides an unsupported number", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "An illustration.", calculation: interest },
      { safeGeneralConversation: true },
    ),
  );
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Calculate simple interest on ₦500 at 10% annual for six months; 1234567890",
  });
  expect(reply.kind).toBe("clarify");
  expect(reply.text).not.toContain("₦25.00");
});
it("keeps a historical question without dates in the read workflow and asks for dates", async () => {
  const s = setup(scripted({ route: "payment_draft" }, search("Musa")));
  const reply = await s
    .agent()
    .turn({ ...s.input, text: "Have I transferred money to Musa?" });
  expect(reply.kind).toBe("clarify");
  expect(reply.text).toContain("Which exact dates");
  expect(reply.handoff).toBeUndefined();
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});
