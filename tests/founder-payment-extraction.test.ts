import { afterEach, expect, it, vi } from "vitest";
import { extractConversationPayment } from "../src/lib/intelligence";
import { groundProposal } from "../src/lib/conversation-policy";
import { FixtureProvider } from "../src/lib/paystack";

const text =
  "Send 500 to Musa, he uses OPay and his account number is 90991234AB. Turn AB to numbers and get his account.";
const proposal = {
  name: "Musa",
  bankCode: "999992",
  accountNumber: "9099123412",
  amountNaira: "500",
  reason: "Payment",
  confidence: "high" as const,
  warnings: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("retains valid details from mocked extraction while discarding an unconfirmed conversion", async () => {
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_API_KEY", "mock-only");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: "prepare",
                    payments: [proposal],
                    period: "all",
                    category: null,
                  }),
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  const [draft] = await extractConversationPayment(text);
  expect(draft).toMatchObject({
    name: "Musa",
    bankCode: "999992",
    amountNaira: "500",
    accountNumber: null,
  });
  expect(draft.warnings.join(" ")).toMatch(
    /Confirm the letter-to-number mapping/,
  );
  expect(draft.warnings.join(" ")).not.toContain("9099123412");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("never grounds a ten-digit substring of a malformed account token", () => {
  expect(
    groundProposal(proposal, "Send 500 to Musa at OPay account 9099123412AB")
      .accountNumber,
  ).toBeNull();
  expect(
    groundProposal(proposal, "Send 500 to Musa at OPay account 9099123412")
      .accountNumber,
  ).toBe("9099123412");
});
it("reproduces fixture verification rejection for wrong bank or unlisted destination", async () => {
  const fixture = new FixtureProvider();
  await expect(fixture.resolve("0000000001", "044")).rejects.toThrow(
    "Fixture account not found",
  );
  await expect(fixture.resolve("9099123412", "999992")).rejects.toThrow(
    "Fixture account not found",
  );
  await expect(fixture.resolve("0000000001", "035")).resolves.toMatchObject({
    data: { account_name: "ADA OKAFOR" },
  });
});
