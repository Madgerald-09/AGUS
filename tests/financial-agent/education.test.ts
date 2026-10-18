import { expect, it, vi } from "vitest";
import { scripted, setup, financial, search } from "./helpers";

const answer =
  "Inflation is a sustained rise in the general price level. Money buys fewer goods and services as prices rise.";
it.each([
  "What is inflation?",
  "Explain compound interest",
  "What is a budget?",
  "Explain inflation to me",
])("explains %s without accounts, access resolution or tools", async (text) => {
  const s = setup(
    scripted(
      { route: "financial_education" },
      { text: answer },
      { safeGeneralConversation: true },
    ),
  );
  const check = vi.spyOn(s.access, "check");
  const reply = await s.agent().turn({ ...s.input, text, accountIds: [] });
  expect(reply).toMatchObject({
    kind: "general",
    text: answer,
    citations: [],
    evidence: { toolCalls: 0, modelCalls: 3 },
  });
  expect(check).not.toHaveBeenCalled();
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});
it("education ignores a saved selection after consent revocation", async () => {
  const s = setup(
    scripted(
      financial,
      search(),
      { route: "financial_education" },
      { text: answer },
      { safeGeneralConversation: true },
    ),
  );
  await s.agent().turn(s.input);
  await s.repository.revokeConsent(s.input.ctx, "consent-amina", s.clock());
  const check = vi.spyOn(s.access, "check");
  const reply = await s
    .agent()
    .turn({ ...s.input, text: "What is inflation?", accountIds: [] });
  expect(reply.kind).toBe("general");
  expect(check).not.toHaveBeenCalled();
  const generation = s.model.generate.mock.calls.findLast(
    ([task]) => task === "general",
  );
  expect(generation?.[1]).toMatchObject({ history: [], educational: true });
  expect(JSON.stringify(generation)).not.toContain("ada-okafor-oct");
});
it.each([
  "What is my balance?",
  "What did I spend last month?",
  "Explain inflation and my spending",
])("keeps personal/mixed requests on the authorized path: %s", async (text) => {
  const s = setup(scripted({ route: "financial_education" }));
  const reply = await s.agent().turn({ ...s.input, text, accountIds: [] });
  expect(reply.kind).toBe("clarify");
  expect(reply.text).toContain("authorized account");
  expect(s.model.generate).toHaveBeenCalledTimes(1);
});
it.each([
  "Your balance is healthy",
  "I sent the money",
  "You should invest",
  "Inflation guarantees returns",
  "AGUS supports live banking",
  "The payment was successful",
])("rejects unsafe education output: %s", async (text) => {
  const s = setup(
    scripted(
      { route: "financial_education" },
      { text },
      { safeGeneralConversation: true },
    ),
  );
  const reply = await s
    .agent()
    .turn({ ...s.input, text: "What is inflation?", accountIds: [] });
  expect(reply).toMatchObject({
    kind: "unavailable",
    evidence: { code: "GENERAL_REJECTED" },
  });
});
