/* global Response: readonly */
// Explicit test-only transport. Never imported by application code. All outputs
// are scripted fixtures, not evidence of a genuine provider inference.
import "./gemini-conversation.mjs";
const previous = globalThis.fetch;
const range = {
  accountIds: ["amina-current"],
  from: "2026-09-30T23:00:00Z",
  toExclusive: "2026-10-31T23:00:00Z",
};
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
    return previous(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Scripted transport requires explicit fixture credential");
  let prompt;
  try {
    prompt = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
  } catch {
    return previous(input, init);
  }
  const { task, data } = prompt;
  let output;
  if (task === "classify")
    output = {
      route: /inflation|compound interest/i.test(data.text)
        ? "financial_education"
        : /approve|submit|execute/i.test(data.text)
          ? "payment_action"
          : /prepare|send|pay /i.test(data.text)
            ? "payment_draft"
            : /hello|hi[!.]?$/i.test(data.text)
              ? "general"
              : "financial_read",
    };
  else if (task === "general")
    output = {
      text: data.educational
        ? "Inflation is a sustained rise in the general price level. Money buys fewer goods and services as prices rise."
        : "Hello! How has the day been?",
    };
  else if (task === "review_general")
    output = { safeGeneralConversation: true };
  else if (task === "product") output = { topic: "overview" };
  else if (task === "plan") {
    const call = (name, args) => ({
      kind: "call_tool",
      call: {
        protocolVersion: 1,
        callId: `fixture-${data.results.length}`,
        name,
        args,
      },
    });
    if (!data.results.length) {
      if (data.selection)
        output = call("get_transaction", {
          accountId: "amina-current",
          transactionId: "ada-okafor-oct",
        });
      else if (/spend|spent/i.test(data.text))
        output = call("calculate_spending", { ...range, groupBy: "none" });
      else
        output = call("search_transactions", {
          ...range,
          query: "Ada",
          limit: 10,
          cursor: null,
        });
    } else if (
      data.selection &&
      data.results.length === 1 &&
      /evidence/i.test(data.text)
    )
      output = call("find_payment_evidence", {
        accountId: "amina-current",
        transactionId: "ada-okafor-oct",
      });
    else
      output = {
        kind: "respond",
        resultIds: data.results.map((r) => r.resultId),
      };
  }
  if (!output) throw new Error("Unexpected scripted model task");
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(output) }] },
      },
    ],
  });
};
