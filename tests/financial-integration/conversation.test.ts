import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db, readState } from "../../src/lib/db";
import { login } from "../../src/lib/auth";
import { POST } from "../../src/app/api/conversation/route";
import { conversationTurn } from "../../src/lib/financial-integration/conversation";
import { financialContext } from "../../src/lib/financial-integration/service";
import { ContextSchema } from "../../src/lib/financial-agent";
import { createContextPersistence } from "../../src/lib/financial-integration/context-persistence";
import { createDurableRepository } from "../../src/lib/financial-integration/storage";
import {
  scripted,
  financial,
  calc,
  search,
  detail,
  evidence,
} from "../financial-agent/helpers";

let dir: string, token: string;
const base = "http://localhost:3000";
const input = {
  conversationId: "integrated-chat",
  text: "What did I spend in October 2026?",
  accountIds: ["amina-current"],
};
function request(body: unknown = input, cookie = token, origin = base) {
  return new Request(`${base}/api/conversation`, {
    method: "POST",
    headers: {
      cookie: `ha_session=${cookie}`,
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const respond = (_task: string, data: { results: { resultId: string }[] }) => ({
  kind: "respond",
  resultIds: data.results.map((r) => r.resultId),
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agus-conversation-unit-"));
  Object.assign(process.env, {
    DATABASE_URL: `pglite://${dir}`,
    PAYMENT_MODE: "fixture",
    FINANCIAL_DEMO_ENABLED: "true",
    OPERATOR_ID: "conversation-operator",
    APP_ORIGIN: base,
    AI_PROVIDER: "none",
    AI_API_KEY: "",
  });
  const password = randomBytes(24).toString("hex"),
    salt = randomBytes(16).toString("hex");
  process.env.OPERATOR_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  token = await login(password);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

it("authenticates and bounds the HTTP route; rejects identity and model injection", async () => {
  expect((await POST(request(input, ""))).status).toBe(401);
  expect(
    (await POST(request(input, token, "https://evil.invalid"))).status,
  ).toBe(403);
  for (const value of [
    { ...input, tenantId: "other" },
    { ...input, model: "scripted" },
    { ...input, accountIds: ["amina-current", "amina-current"] },
  ])
    expect((await POST(request(value))).status).toBe(400);
  expect((await POST(request({ padding: "x".repeat(17000) }))).status).toBe(
    413,
  );
  process.env.FINANCIAL_DEMO_ENABLED = "false";
  expect((await POST(request())).status).toBe(503);
  process.env.FINANCIAL_DEMO_ENABLED = "true";
  process.env.PAYMENT_MODE = "test";
  expect((await POST(request())).status).toBe(503);
  process.env.PAYMENT_MODE = "fixture";
});
it("reports MODEL_NOT_CONFIGURED without attempting inference", async () => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toMatchObject({
    simulation: { simulated: true },
    reply: {
      kind: "unavailable",
      evidence: { code: "MODEL_NOT_CONFIGURED", toolCalls: 0 },
    },
  });
  expect(transport).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("composes B, A and SQL storage for exact totals and durable ambiguous follow-up", async () => {
  const total = await conversationTurn(
    request(),
    input,
    scripted(financial, calc, respond),
  );
  expect(total.kind).toBe("financial");
  expect(total.text).toContain("₦19,751.51");
  expect(total.text).toContain("SIMULATED FICTIONAL DATA");
  const ambiguous = await conversationTurn(
    request(),
    { ...input, text: "Find Ada in October 2026" },
    scripted(financial, search()),
  );
  expect(ambiguous.kind).toBe("clarify");
  expect(ambiguous.text).toContain("2 candidate");
  const ctx = await financialContext(request());
  const store = createContextPersistence(ctx, ContextSchema.parse);
  const saved = await store.load({
    ...ctx,
    conversationId: input.conversationId,
  });
  expect(saved?.revision).toBe(2);
  expect(saved?.selection?.candidates).toHaveLength(2);
  const follow = await conversationTurn(
    request(),
    { ...input, text: "The smaller one; show its evidence" },
    scripted(financial, detail(), evidence(), respond),
  );
  expect(follow.kind).toBe("financial");
  expect(follow.evidence.toolCalls).toBe(2);
  expect(follow.text).toContain("does not establish recipient bank credit");
  expect(follow.text).not.toMatch(
    /artifactRef|rawRecordRef|providerAccountRef/,
  );
});
it("rejects foreign accounts before financial planning", async () => {
  const model = scripted(financial, calc);
  const result = await conversationTurn(
    request(),
    { ...input, conversationId: "foreign", accountIds: ["tunde-current"] },
    model,
  );
  expect(result.kind).toBe("unavailable");
  expect(result.evidence.toolCalls).toBe(0);
  expect(model.generate).toHaveBeenCalledTimes(1);
});
it("uses actual B schema with atomic CAS and principal isolation", async () => {
  const ctx = await financialContext(request());
  const store = createContextPersistence(ctx, ContextSchema.parse);
  const key = {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    conversationId: "cas-real-b",
  };
  const next = {
    ...key,
    schemaVersion: 1 as const,
    revision: 1,
    messages: [],
    selection: null,
  };
  expect(
    await Promise.all([
      store.compareAndSwap(key, null, next),
      store.compareAndSwap(key, null, next),
    ]),
  ).toEqual([true, false]);
  await expect(
    store.load({ ...key, actorId: "fictional-tunde" }),
  ).rejects.toThrow();
});
it("keeps payment handoff intent-only and refuses execution", async () => {
  const before = await readState();
  const handoff = await conversationTurn(
    request(),
    { ...input, text: "Prepare a payment to Ada" },
    scripted({ route: "general" }),
  );
  expect(handoff.handoff).toEqual({ kind: "existing_payment_draft" });
  const action = await conversationTurn(
    request(),
    { ...input, text: "Approve and submit my payment" },
    scripted({ route: "payment_action" }),
  );
  expect(action.kind).toBe("clarify");
  expect(await readState()).toEqual(before);
});
it("rejects changed permissions on follow-up while education needs no grant", async () => {
  const ctx = await financialContext(request());
  await createDurableRepository().revokeConsent(
    ctx,
    "consent-amina",
    new Date().toISOString(),
  );
  const failed = await conversationTurn(
    request(),
    { ...input, text: "Show that transaction" },
    scripted(financial),
  );
  expect(failed.kind).toBe("unavailable");
  expect(failed.evidence.toolCalls).toBe(0);
  const text =
    "Inflation is a sustained rise in the general price level. Money buys fewer goods and services.";
  const education = await conversationTurn(
    request(),
    { ...input, text: "What is inflation?", accountIds: [] },
    scripted(
      { route: "financial_education" },
      { text },
      { safeGeneralConversation: true },
    ),
  );
  expect(education).toMatchObject({
    kind: "general",
    text,
    evidence: { toolCalls: 0 },
  });
  const d = await db();
  const row = await d.execute(
    sql`SELECT payload FROM fm_context WHERE id='agentb.integrated-chat'`,
  );
  expect(ContextSchema.parse(row.rows[0].payload).selection).toBeNull();
});
