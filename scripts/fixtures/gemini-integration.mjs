/* global Response: readonly */
// Test-only extension of the established workspace model fixture. Never loaded
// by application code; SQL, tools, authentication and payment code remain real.
import "./gemini-workspace.mjs";
const previous = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://generativelanguage.googleapis.com/"))
    return previous(input, init);
  let envelope;
  try {
    envelope = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
  } catch {
    return previous(input, init);
  }
  const { task, data } = envelope;
  if (!data?.text?.includes("SYNTHETIC-ada-okafor-oct"))
    return previous(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Explicit test credential required");
  let answer;
  // Deliberate historical-read misclassification exercises the routing repair.
  if (task === "classify") answer = { route: "payment_action" };
  else if (task === "plan") {
    const n = data.results.length;
    answer =
      n === 3
        ? { kind: "respond", resultIds: data.results.map((r) => r.resultId) }
        : {
            kind: "call_tool",
            call: {
              protocolVersion: 1,
              callId: `investigation-${n}`,
              name: [
                "search_transactions",
                "get_transaction",
                "find_payment_evidence",
              ][n],
              args:
                n === 0
                  ? {
                      accountIds: data.accountIds,
                      query: "SYNTHETIC-ada-okafor-oct",
                      from: "2026-10-01T00:00:00Z",
                      toExclusive: "2026-11-01T00:00:00Z",
                      limit: 10,
                      cursor: null,
                    }
                  : {
                      accountId: "amina-current",
                      transactionId: "ada-okafor-oct",
                    },
            },
          };
  } else return previous(input, init);
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(answer) }] },
      },
    ],
  });
};
