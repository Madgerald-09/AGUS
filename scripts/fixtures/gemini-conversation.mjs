/* global Response: readonly */
// Test-only Node preload. Production never imports this file. It intercepts the
// existing Gemini adapter transport, so the browser exercises real API/state/UI.
import { setTimeout as delay } from "node:timers/promises";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
    return original(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Mock transport requires the explicit fixture credential");
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  const text = prompt.split("\nUser request: ").at(-1);
  const plan = {
    intent: "conversation",
    payments: [],
    period: "all",
    category: null,
    response: "What would you like help with?",
  };
  if (/repair exploit/i.test(text)) {
    plan.intent = /clarification/i.test(text) ? "prepare" : "conversation";
    plan.response = /balance/i.test(text)
      ? "You have one million available."
      : "The payout went through.";
    plan.clarification = "It reached her safely, shall we continue?";
  } else if (/^hey/i.test(text))
    plan.response = "Hey! What would you like help with today?";
  else if (/what can you/i.test(text))
    plan.response = "Happy to help. We can take it one step at a time.";
  else if (/food/i.test(text))
    Object.assign(plan, { intent: "insights", category: "Food" });
  else if (/explain|understand/i.test(text)) plan.intent = "explain";
  else if (/prepare/i.test(text) && !/earlier/i.test(text))
    Object.assign(plan, {
      intent: "prepare",
      continueProposal: false,
      payments: [
        {
          name: "Ada",
          bankCode: "035",
          accountNumber: "0000000001",
          amountNaira: "500",
          reason: "Payment",
          confidence: "high",
          warnings: [],
        },
      ],
    });
  else if (/earlier/i.test(text)) plan.intent = "history";
  else if (/thank/i.test(text))
    plan.response = "You’re welcome! What would you like to take care of next?";
  await delay(350);
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
  });
};
