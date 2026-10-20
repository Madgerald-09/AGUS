import { beforeAll, afterAll, expect, it } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { login } from "../../src/lib/auth";
import { chatHistory } from "../../src/lib/chat-history/store";
import { GET } from "../../src/app/api/conversations/route";
import { POST } from "../../src/app/api/conversation/route";
import { conversationTurn } from "../../src/lib/financial-integration/conversation";
import { scripted, financial, calc } from "../financial-agent/helpers";
import type { AgentReply } from "../../src/lib/financial-agent";
let dir: string, token: string;
const base = "http://localhost:3000";
const reply: AgentReply = {
  kind: "general",
  text: "Hello there.",
  citations: [],
  evidence: { modelCalls: 3, toolCalls: 0, resultBytes: 0 },
};
const history = chatHistory("history-operator");
const request = (query = "", cookie = token) =>
  new Request(`${base}/api/conversations${query}`, {
    headers: { cookie: `ha_session=${cookie}` },
  });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agus-chat-history-"));
  Object.assign(process.env, {
    DATABASE_URL: `pglite://${join(dir, "db")}`,
    PAYMENT_MODE: "fixture",
    FINANCIAL_DEMO_ENABLED: "true",
    OPERATOR_ID: "history-operator",
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
  await rm(dir, { recursive: true, force: true });
});
it("persists ordered complete replies with server titles; isolates identical IDs by authenticated owner", async () => {
  const lease = await history.claim("chat-a", "Hello password=do-not-retain");
  const saved = await history.finish(
    "chat-a",
    lease,
    "Hello password=do-not-retain",
    reply,
  );
  expect(saved.text).toBe("Hello [credential withheld]");
  const lease2 = await history.claim("chat-a", "Follow up");
  await history.finish("chat-a", lease2, "Follow up", reply);
  expect(await history.read("chat-a")).toHaveLength(2);
  expect((await history.list())[0].title).toBe("Hello [credential withheld]");
  const other = chatHistory("different-operator");
  expect(await other.list()).toEqual([]);
  await expect(other.read("chat-a")).rejects.toMatchObject({ status: 404 });
  const ownLease = await other.claim("chat-a", "Other owner's title");
  await other.finish("chat-a", ownLease, "Other owner's text", reply);
  expect((await other.read("chat-a"))[0].text).toBe("Other owner's text");
  expect((await history.read("chat-a"))[0]).toEqual(saved);
  const response = await GET(request("?id=chat-a"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect((await response.json()).turns).toHaveLength(2);
});
it("authenticates all history reads and rejects injected scopes, malformed and foreign IDs", async () => {
  expect((await GET(request("", ""))).status).toBe(401);
  expect((await GET(request("?owner=different-operator"))).status).toBe(400);
  expect((await GET(request("?id=a&id=b"))).status).toBe(400);
  expect((await GET(request("?id=%3Cscript%3E"))).status).toBe(400);
  expect((await GET(request("?id=nonexistent"))).status).toBe(404);
});
it("serializes concurrent turns and recovers stale request leases without accepting stale writes", async () => {
  const lease = await history.claim("concurrent", "First");
  await expect(history.claim("concurrent", "Second")).rejects.toMatchObject({
    status: 409,
  });
  const d = await db();
  await d.execute(
    sql`UPDATE chat_history SET lease_until=now()-interval '1 second' WHERE owner='history-operator' AND id='concurrent'`,
  );
  const replacement = await history.claim("concurrent", "Second");
  await expect(
    history.finish("concurrent", lease, "First", reply),
  ).rejects.toMatchObject({ status: 409 });
  await history.release("concurrent", lease);
  await history.finish("concurrent", replacement, "Second", reply);
  expect((await history.read("concurrent")).map((t) => t.text)).toEqual([
    "Second",
  ]);
});
it("stores failed provider replies from the actual route so reload can restore them", async () => {
  const response = await POST(
    new Request(`${base}/api/conversation`, {
      method: "POST",
      headers: {
        cookie: `ha_session=${token}`,
        origin: base,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "provider-failure",
        text: "Hello",
        accountIds: [],
      }),
    }),
  );
  expect(response.status).toBe(503);
  const data = await response.json();
  expect(data.turn.reply.evidence.code).toBe("MODEL_NOT_CONFIGURED");
  expect(await history.read("provider-failure")).toEqual([data.turn]);
});
it("keeps visible history through context expiry and renews financial context using current permission checks", async () => {
  const input = {
    conversationId: "expired-chat",
    text: "Show October 2026 spending",
    accountIds: ["amina-current"],
  };
  const req = new Request(`${base}/api/conversation`, {
    headers: { cookie: `ha_session=${token}` },
  });
  const model = () =>
    scripted(
      financial,
      calc,
      (_: string, data: { results: { resultId: string }[] }) => ({
        kind: "respond",
        resultIds: data.results.map((r) => r.resultId),
      }),
    );
  const first = await conversationTurn(req, input, model());
  expect(first.kind).toBe("financial");
  const lease = await history.claim(input.conversationId, input.text);
  await history.finish(input.conversationId, lease, input.text, first);
  const d = await db();
  await d.execute(
    sql`UPDATE fm_context SET expires_at=now()-interval '1 second' WHERE id='agentb.expired-chat'`,
  );
  const fresh = await conversationTurn(req, input, model());
  expect(fresh.kind).toBe("financial");
  expect(fresh.text).toContain("₦19,751.51");
  const rows = await d.execute(
    sql`SELECT revision FROM fm_context WHERE id='agentb.expired-chat'`,
  );
  expect(rows.rows[0].revision).toBe(1);
  expect((await history.read(input.conversationId))[0].reply).toEqual(first);
  const denied = await conversationTurn(
    req,
    { ...input, accountIds: ["foreign-account"] },
    scripted(financial),
  );
  expect(denied.kind).toBe("unavailable");
  expect(denied.evidence.toolCalls).toBe(0);
});
it("restores the transcript after a complete process restart", async () => {
  const restartDir = join(dir, "restart-db");
  for (const action of ["write", "read"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "tests/financial-integration/chat-history-worker.ts",
        action,
      ],
      {
        env: { ...process.env, DATABASE_URL: `pglite://${restartDir}` },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      text: "Persist this conversation",
      reply: { text: "Hello there." },
    });
  }
}, 60000);
