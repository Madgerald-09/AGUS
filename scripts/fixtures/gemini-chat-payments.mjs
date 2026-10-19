/* global Response: readonly */
// Mocked Gemini only. The server's auth, SQL, payment APIs and engine stay real.
import "./gemini-integration.mjs";
const previous = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
    return previous(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Explicit test credential required");
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  try {
    const envelope = JSON.parse(prompt);
    if (envelope.task === "reason") {
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    text: /millionaire/.test(envelope.data.text)
                      ? "How much could you realistically save each month?"
                      : "You can start with expected income, fixed expenses and savings goals. What are those for next month? Any earlier income figure you supplied is an unverified assumption.",
                    calculation: /millionaire/.test(envelope.data.text)
                      ? {
                          kind: "savings_goal",
                          monthlySavingsNaira: "70000",
                          targetNaira: "1000000",
                          startingNaira: "0",
                        }
                      : /250,000/.test(envelope.data.text)
                        ? {
                            kind: "savings_total",
                            incomeNaira: "250000",
                            savingsPercent: "20",
                            months: 6,
                          }
                        : null,
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    if (envelope.task === "classify" && /^Prepare/i.test(envelope.data.text)) {
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: JSON.stringify({ route: "payment_draft" }) }],
            },
          },
        ],
      });
    }
  } catch {
    /* Payment extraction uses the existing text prompt. */
  }
  if (
    prompt.includes("\nUser request: ") &&
    /prepare|Send 500 to Musa/i.test(prompt.split("\nUser request: ").at(-1))
  ) {
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  intent: "prepare",
                  period: "all",
                  category: null,
                  continueProposal: false,
                  payments: /Send 500 to Musa/.test(prompt)
                    ? [
                        {
                          name: "Musa",
                          bankCode: "999992",
                          accountNumber: "9099123412",
                          amountNaira: "500",
                          reason: "Payment",
                          confidence: "high",
                          warnings: [],
                        },
                      ]
                    : [
                        {
                          name: "Ada",
                          bankCode: "035",
                          accountNumber: "0000000001",
                          amountNaira: "500",
                          reason: "Lunch",
                          confidence: "high",
                          warnings: [],
                        },
                        {
                          name: "Chidi",
                          bankCode: "044",
                          accountNumber: "0000000002",
                          amountNaira: "600",
                          reason: "Books",
                          confidence: "high",
                          warnings: [],
                        },
                      ],
                }),
              },
            ],
          },
        },
      ],
    });
  }
  return previous(input, init);
};
