/* global Response: readonly */
// Explicit test-only transport. No production route can select this model.
import "./gemini-conversation.mjs";
import { setTimeout as delay } from "node:timers/promises";
const previous = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
    return previous(input, init);
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  let envelope;
  try {
    envelope = JSON.parse(prompt);
  } catch {
    return previous(input, init);
  }
  if (!envelope.task) return previous(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Explicit test credential required");
  const { task, data } = envelope;
  let answer;
  if (task === "classify")
    answer = {
      route: /inflation/i.test(data.text)
        ? "financial_education"
        : /spend|candidate|find payment/i.test(data.text)
          ? "financial_read"
          : "general",
    };
  else if (task === "general")
    answer = {
      text: data.educational
        ? "Inflation means prices rise over time. When the same amount buys fewer goods, purchasing power falls. For a hypothetical example, an item that costs ₦100 today might cost ₦110 later. The example illustrates a concept; it is not a current inflation rate."
        : "Hey! We can talk through an idea, learn something new, or take things one step at a time. What’s on your mind?",
    };
  else if (task === "review_general")
    answer = { safeGeneralConversation: true };
  else if (task === "product") answer = { topic: "overview" };
  else if (task === "plan") {
    if (data.results.length)
      answer = {
        kind: "respond",
        resultIds: data.results.map((r) => r.resultId),
      };
    else if (!data.accountIds.length)
      answer = { kind: "clarify", reason: "account" };
    else {
      const search = /find payment/i.test(data.text);
      answer = {
        kind: "call_tool",
        call: {
          protocolVersion: 1,
          callId: search ? "search" : "calc",
          name: search ? "search_transactions" : "calculate_spending",
          args: {
            accountIds: data.accountIds,
            from: "2026-09-30T23:00:00Z",
            toExclusive: "2026-10-31T23:00:00Z",
            ...(search
              ? { query: "Ada", limit: 10, cursor: null }
              : { groupBy: "none" }),
          },
        },
      };
    }
  } else throw new Error("Unknown fixture task");
  await delay(180);
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(answer) }] },
      },
    ],
  });
};
