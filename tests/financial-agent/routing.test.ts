import { describe, expect, it, vi } from "vitest";
import { ToolCallSchema } from "../../src/lib/financial-data/contracts";
import { detail, evidence, scripted, search, setup } from "./helpers";

const investigation =
  "Search amina-current in October 2026 for exact reference SYNTHETIC-ada-okafor-oct, then retrieve transaction details and payment evidence. Explain what that evidence establishes.";
const respond = (
  _task: string,
  input: { results: { resultId: string }[] },
) => ({
  kind: "respond",
  resultIds: input.results.map((r) => r.resultId),
});

describe.each(["payment_action", "payment_draft"])(
  "historical reads misclassified as %s (scripted model only)",
  (route) => {
    it.each([
      "Search transactions in amina-current in October 2026 for Ada Okafor",
      "Please find payments to Ada Okafor in October 2026",
      "Could you list transfers in October 2026 for Ada Okafor?",
      "Look up exact reference SYNTHETIC-ada-okafor-oct in October 2026",
    ])("enters the grounded search workflow: %s", async (text) => {
      const s = setup(
        scripted({ route }, search("SYNTHETIC-ada-okafor-oct"), respond),
      );
      const result = await s.agent().turn({ ...s.input, text });
      expect(result).toMatchObject({
        kind: "financial",
        evidence: { modelCalls: 4, toolCalls: 1 },
      });
      expect(result.citations).toHaveLength(1);
      expect(s.model.generate.mock.calls.map(([task]) => task)).toEqual([
        "classify",
        "plan",
        "plan",
        "narrate",
      ]);
    });

    it.each([
      investigation,
      "Show payment evidence for the October 2026 transaction with reference SYNTHETIC-ada-okafor-oct",
      "Retrieve transaction details and payment evidence for SYNTHETIC-ada-okafor-oct in October 2026",
    ])("completes search, detail, then evidence: %s", async (text) => {
      const proposed = search("SYNTHETIC-ada-okafor-oct");
      proposed.call.args = {
        ...proposed.call.args,
        from: "2026-10-01T00:00:00Z",
        toExclusive: "2026-11-01T00:00:00Z",
      };
      const s = setup(
        scripted({ route }, proposed, detail(), evidence(), respond),
      );
      const result = await s.agent().turn({ ...s.input, text });
      expect(result).toMatchObject({
        kind: "financial",
        evidence: { modelCalls: 6, toolCalls: 3 },
      });
      const calls = vi
        .mocked(s.tools.dispatch)
        .mock.calls.map(([, call]) => ToolCallSchema.parse(call));
      expect(calls.map((call) => call.name)).toEqual([
        "search_transactions",
        "get_transaction",
        "find_payment_evidence",
      ]);
      expect(calls[0].args).toEqual({
        ...proposed.call.args,
        from: "2026-09-30T23:00:00.000Z",
        toExclusive: "2026-10-31T23:00:00.000Z",
      });
      expect(result.citations).toHaveLength(3);
      expect(result.text).toContain("SIMULATED FICTIONAL DATA");
      expect(result.text).toContain("Fictional synthetic evidence");
      expect(result.text).toContain("does not establish recipient bank credit");
      expect(result).not.toHaveProperty("handoff");
    });

    it.each([
      { beforeEvidence: [] },
      { beforeEvidence: [search("SYNTHETIC-ada-okafor-oct")] },
    ])(
      "still rejects evidence without current-turn details %#",
      async ({ beforeEvidence }) => {
        const s = setup(scripted({ route }, ...beforeEvidence, evidence()));
        const result = await s
          .agent()
          .turn({ ...s.input, text: investigation });
        expect(result).toMatchObject({
          kind: "unavailable",
          citations: [],
          evidence: {
            code: "DETAIL_REQUIRED",
            toolCalls: beforeEvidence.length,
          },
        });
        expect(
          vi
            .mocked(s.tools.dispatch)
            .mock.calls.map(([, call]) => ToolCallSchema.parse(call).name),
        ).not.toContain("find_payment_evidence");
      },
    );

    it("still requires an authorized account", async () => {
      const s = setup(scripted({ route }));
      const result = await s.agent().turn({
        ...s.input,
        text: investigation,
        accountIds: [],
      });
      expect(result.kind).toBe("clarify");
      expect(result.text).toContain("Which account");
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    });

    it("still rejects out-of-scope planner accounts", async () => {
      const s = setup(scripted({ route }, detail()));
      const result = await s.agent().turn({
        ...s.input,
        text: investigation,
        accountIds: ["amina-savings"],
      });
      expect(result.evidence.code).toBe("PERMISSION_DENIED");
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    });

    it("still suppresses facts after consent revocation", async () => {
      const s = setup(scripted({ route }, search("SYNTHETIC-ada-okafor-oct")));
      s.options.tools = {
        ...s.realTools,
        async dispatch(ctx, call) {
          const result = await s.realTools.dispatch(ctx, call);
          await s.repository.revokeConsent(ctx, "consent-amina", s.clock());
          return result;
        },
      };
      const result = await s.agent().turn({ ...s.input, text: investigation });
      expect(result.kind).toBe("unavailable");
      expect(result.citations).toEqual([]);
      expect(result.text).not.toContain("₦");
    });

    it("does not expose payment execution to the read planner", async () => {
      const s = setup(
        scripted(
          { route },
          {
            kind: "call_tool",
            call: {
              protocolVersion: 1,
              callId: "execute",
              name: "submit_payment",
              args: {},
            },
          },
        ),
      );
      const result = await s.agent().turn({ ...s.input, text: investigation });
      expect(result.kind).toBe("unavailable");
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    });

    it.each([
      "Review the payment",
      "Find the payment and take care of it",
      "Search October 2026 transactions, then proceed",
      "Search October 2026 transactions and do it if needed",
      "Find the payment and go ahead",
      "Find the payment; handle it",
      "Find the payment, then initiate a new transfer",
      "Search October 2026 transactions and schedule another transfer",
      "Find the transaction and wire the same amount again",
      "Find the payment and settle it",
      "Find the payment and sort it out",
      "Find the payment, transfer NGN 500 to Ada",
      "Find the payment: settle it",
      "Find the payment & release the funds",
      "Find the payment before transferring NGN 500 to Ada",
      "Show payment evidence for moving money to Ada",
      "Find the payment or take the next step",
      "Find the payment if needed settle it",
      "Show payment evidence and confirm it",
      "Find the payment. Use otp=123456",
      "Show payment evidence; https://example.test/execute",
    ])(
      "preserves the model's safe payment route for unclear/action intent: %s",
      async (text) => {
        const s = setup(scripted({ route }));
        const result = await s.agent().turn({ ...s.input, text });
        expect(["clarify", "handoff"]).toContain(result.kind);
        expect(result.evidence).toMatchObject({ modelCalls: 1, toolCalls: 0 });
        expect(s.tools.dispatch).not.toHaveBeenCalled();
      },
    );
  },
);

describe("explicit payment intent keeps precedence over read wording", () => {
  it.each([
    ["Approve the payment", "clarify"],
    ["Submit the payment", "clarify"],
    ["Retry the transfer", "clarify"],
    ["Execute the payment", "clarify"],
    ["Find October 2026 transactions and approve the transfer", "clarify"],
    ["Show payment evidence, then submit it", "clarify"],
    ["Find the payment and use this OTP", "clarify"],
    ["Prepare a payment to Ada", "handoff"],
    ["Find October 2026 transactions then pay Ada NGN 500", "handoff"],
    ["Show payment evidence and draft another transfer", "handoff"],
  ])(
    "retains payment restrictions even if classified as a read: %s",
    async (text, kind) => {
      const s = setup(scripted({ route: "financial_read" }));
      const result = await s.agent().turn({ ...s.input, text });
      expect(result.kind).toBe(kind);
      expect(result.evidence).toMatchObject({ modelCalls: 1, toolCalls: 0 });
      expect(s.tools.dispatch).not.toHaveBeenCalled();
    },
  );

  it("still asks for dates before an interval tool on a corrected read", async () => {
    const s = setup(scripted({ route: "payment_action" }, search()));
    const result = await s.agent().turn({
      ...s.input,
      text: "Search transactions for Ada Okafor",
    });
    expect(result.kind).toBe("clarify");
    expect(result.text).toContain("Which exact dates");
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });

  it("still rejects a fabricated result citation on a corrected read", async () => {
    const s = setup(
      scripted(
        { route: "payment_draft" },
        {
          kind: "respond",
          resultIds: ["invented-source"],
        },
      ),
    );
    const result = await s.agent().turn({ ...s.input, text: investigation });
    expect(result.evidence.code).toBe("UNCITED_RESPONSE");
    expect(result.citations).toEqual([]);
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
});
