import { beforeAll, afterAll, expect, it } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { login, logout } from "../../src/lib/auth";
import { GET, POST } from "../../src/app/api/financial-agent/route";
import {
  createDurableRepository,
  initializeFinancialStorage,
} from "../../src/lib/financial-integration/storage";
import { financialContext } from "../../src/lib/financial-integration/service";
import {
  createContextStore,
  type ConversationState,
} from "../../src/lib/financial-integration/context-store";
import { createReadTools } from "../../src/lib/financial-data/tools";
import {
  createFixtureDataSource,
  FIXTURE_NOW,
  fixturePrincipal,
  fixtureOtherPrincipal,
} from "../../src/lib/financial-data/fixture";
import { readState } from "../../src/lib/db";
import type { Principal } from "../../src/lib/financial-data/contracts";
import { authorizedFinancialAccess } from "../../src/lib/financial-integration/access";
import { readFile } from "node:fs/promises";
import { createContextPersistence } from "../../src/lib/financial-integration/context-persistence";
import { TestContextSchema } from "./persistence-codec";

let dir: string, token: string;
const base = "http://localhost:3000/api/financial-agent";
const repo = createDurableRepository();
const req = (
  body?: unknown,
  cookie = token,
  origin = "http://localhost:3000",
  url = base,
) =>
  new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: `ha_session=${cookie}`,
      origin,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = (
  name = "get_account_summary",
  args: unknown = { accountIds: ["amina-current"] },
) => ({ protocolVersion: 1, callId: "integration-check", name, args });
const state: ConversationState = {
  schemaVersion: 1,
  accountIds: ["amina-current"],
  selected: { accountId: "amina-current", transactionId: "tx-ada-okafor" },
  messages: [{ role: "user", text: "show that payment" }],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agus-integration-unit-"));
  process.env.DATABASE_URL = `pglite://${dir}`;
  process.env.PAYMENT_MODE = "fixture";
  process.env.FINANCIAL_DEMO_ENABLED = "true";
  process.env.OPERATOR_ID = "integration-operator";
  process.env.APP_ORIGIN = "http://localhost:3000";
  const password = randomBytes(24).toString("hex"),
    salt = randomBytes(16).toString("hex");
  process.env.OPERATOR_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  token = await login(password);
  await initializeFinancialStorage();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("requires a current authenticated session, exact POST origin and explicit fixture opt-in", async () => {
  expect((await POST(req(call(), ""))).status).toBe(401);
  expect((await GET(req(undefined, "bogus"))).status).toBe(401);
  expect(
    (await POST(req(call(), token, "https://attacker.invalid"))).status,
  ).toBe(403);
  expect(
    (await GET(req(undefined, token, "https://attacker.invalid"))).status,
  ).toBe(403);
  process.env.FINANCIAL_DEMO_ENABLED = "false";
  expect((await POST(req(call()))).status).toBe(503);
  process.env.FINANCIAL_DEMO_ENABLED = "true";
  process.env.PAYMENT_MODE = "test";
  expect((await POST(req(call()))).status).toBe(503);
  process.env.PAYMENT_MODE = "fixture";
  const d = await db();
  await d.execute(
    sql`UPDATE operator_sessions SET expires_at=now()-interval '1 second'`,
  );
  expect((await POST(req(call()))).status).toBe(401);
  await d.execute(
    sql`UPDATE operator_sessions SET expires_at=now()+interval '1 hour'`,
  );
});

it("binds identity on the server and rejects spoofing, unknown tools and oversized input", async () => {
  const ctx = await financialContext(req());
  expect(ctx.actorId).toBe("fictional-amina");
  const result = await GET(req());
  expect(result.headers.get("cache-control")).toContain("no-store");
  const data = await result.json();
  expect(data.accounts.map((a: { accountId: string }) => a.accountId)).toEqual([
    "amina-current",
    "amina-savings",
  ]);
  expect(JSON.stringify(data)).not.toMatch(
    /consentId|ownerId|tenantId|rawRecord|artifactRef|tokenHash/,
  );
  expect(data.simulation.simulated).toBe(true);
  for (const body of [
    { ...call(), actorId: "fictional-tunde" },
    call("execute_payment", {}),
    call("get_account_summary", {
      accountIds: ["amina-current"],
      permissions: ["*"],
    }),
  ])
    expect((await POST(req(body))).status).toBe(400);
  expect(
    (
      await GET(
        req(
          undefined,
          token,
          "http://localhost:3000",
          `${base}?actorId=fictional-tunde`,
        ),
      )
    ).status,
  ).toBe(400);
  expect((await POST(req({ padding: "x".repeat(9000) }))).status).toBe(413);
});

it("denies foreign accounts in all five tools and hides individual record existence", async () => {
  const foreign = [
    call("get_account_summary", { accountIds: ["tunde-current"] }),
    call("get_transaction", {
      accountId: "tunde-current",
      transactionId: "private-tunde",
    }),
    call("find_payment_evidence", {
      accountId: "tunde-current",
      transactionId: "private-tunde",
    }),
    ...["search_transactions", "calculate_spending"].map((name) =>
      call(name, {
        accountIds: ["tunde-current"],
        from: "2026-09-30T23:00:00Z",
        toExclusive: "2026-10-31T23:00:00Z",
        ...(name === "search_transactions"
          ? { query: "", limit: 10, cursor: null }
          : { groupBy: "none" }),
      }),
    ),
  ];
  for (const body of foreign) {
    const response = await POST(req(body));
    expect([403, 404]).toContain(response.status);
    const data = await response.json();
    expect(data.result.data).toBeNull();
    expect(JSON.stringify(data)).not.toContain("Private");
  }
  expect(
    await repo.getAccount(fixtureOtherPrincipal, "amina-current"),
  ).toBeNull();
});

it("binds injected dispatchers to the session even when an orchestrator supplies a forged principal", async () => {
  const access = await authorizedFinancialAccess(req());
  const foreign = await access.tools.dispatch(
    fixtureOtherPrincipal,
    call("get_account_summary", { accountIds: ["tunde-current"] }),
  );
  expect(foreign.error?.code).toBe("PERMISSION_DENIED");
  const own = await access.tools.dispatch(fixtureOtherPrincipal, call());
  expect(own.error).toBeNull();
});

it("preserves server-owned principal bindings and enforces composite evidence foreign keys", async () => {
  const d = await db();
  await d.execute(
    sql`UPDATE fm_principals SET owner='fictional-tunde' WHERE operator_id='integration-operator'`,
  );
  expect(
    (await (await GET(req())).json()).accounts.map(
      (a: { accountId: string }) => a.accountId,
    ),
  ).toEqual(["tunde-current"]);
  expect((await POST(req(call()))).status).toBe(403);
  await d.execute(
    sql`UPDATE fm_principals SET owner='fictional-amina' WHERE operator_id='integration-operator'`,
  );
  await expect(
    d.execute(sql`INSERT INTO fm_evidence SELECT tenant, 'fictional-tunde', 'tunde-current', 'cross-owner-evidence', transaction_id,
    payload || '{"ownerId":"fictional-tunde","accountId":"tunde-current","id":"cross-owner-evidence"}'::jsonb FROM fm_evidence WHERE id='evidence-ada'`),
  ).rejects.toMatchObject({ cause: { code: "23503" } });
  const source = await readFile(
    "src/lib/financial-integration/storage.ts",
    "utf8",
  );
  const migration = await readFile(
    "migrations/0002_financial_memory.sql",
    "utf8",
  );
  expect(migration.trim()).toBe(
    source.split("const ddl = `")[1].split("`;")[0].trim(),
  );
  const indexed = await d.execute(
    sql`SELECT count(*)::integer AS count FROM fm_transactions WHERE search_text <> ''`,
  );
  expect(indexed.rows[0].count).toBe(77);
});

it("calculates exact totals from persisted pages and withholds stale balances", async () => {
  const clock = () => FIXTURE_NOW;
  const tools = createReadTools({
    repository: repo,
    sources: [createFixtureDataSource({ repository: repo, clock })],
    clock,
  });
  const result = await tools.dispatch(
    fixturePrincipal,
    call("calculate_spending", {
      accountIds: ["amina-current"],
      from: "2026-09-30T23:00:00Z",
      toExclusive: "2026-10-31T23:00:00Z",
      groupBy: "month",
    }),
  );
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({
    expenseKobo: 1975151,
    incomeKobo: 25000000,
    netKobo: 23024849,
    includedCount: 66,
  });
  const response = await POST(req(call()));
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.result.data.accounts[0].simulated).toBe(true);
  const later = () => "2026-10-19T10:00:00.000Z";
  const staleTools = createReadTools({
    repository: repo,
    sources: [createFixtureDataSource({ repository: repo, clock: later })],
    clock: later,
  });
  const stale = await staleTools.execute(fixturePrincipal, {
    protocolVersion: 1,
    callId: "stale-balance",
    name: "get_account_summary",
    args: { accountIds: ["amina-current"] },
  });
  expect(stale.data!.accounts[0]).toMatchObject({
    availableKobo: null,
    currentKobo: null,
    unavailableReason: "stale",
  });
});

it("supports a lossless injected context schema with scoped CAS and no account-grant requirement for general conversation", async () => {
  const key = { ...fixturePrincipal, conversationId: "schema-injection" };
  const store = createContextPersistence(
    fixturePrincipal,
    TestContextSchema.parse,
    () => FIXTURE_NOW,
  );
  const next = {
    tenantId: key.tenantId,
    actorId: key.actorId,
    conversationId: key.conversationId,
    schemaVersion: 1 as const,
    revision: 1,
    transcript: "Untrusted general education conversation; no account data.",
  };
  expect(await store.compareAndSwap(key, null, next)).toBe(true);
  expect(await store.load(key)).toEqual(next);
  const results = await Promise.all([
    store.compareAndSwap(key, 1, { ...next, revision: 2 }),
    store.compareAndSwap(key, 1, { ...next, revision: 2 }),
  ]);
  expect(results.sort()).toEqual([false, true]);
  await expect(
    store.load({ ...key, actorId: fixtureOtherPrincipal.actorId }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    store.compareAndSwap(key, 2, {
      ...next,
      revision: 3,
      actorId: fixtureOtherPrincipal.actorId,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    store.compareAndSwap(key, 2, {
      ...next,
      revision: 3,
      transcript: "x".repeat(40000),
    }),
  ).rejects.toMatchObject({ status: 413 });
  const expired = createContextPersistence(
    fixturePrincipal,
    TestContextSchema.parse,
    () => "2026-10-17T10:15:00.000Z",
  );
  expect(await expired.load(key)).toBeNull();
  expect(await expired.compareAndSwap(key, null, next)).toBe(true);
});

it("suppresses a result when consent is revoked during persisted provider I/O", async () => {
  const clock = () => FIXTURE_NOW;
  const rows = await repo.listTransactions(
    fixtureOtherPrincipal,
    "tunde-current",
  );
  const racing = {
    ...repo,
    async getTransaction(p: Principal, a: string, id: string) {
      const transaction = await repo.getTransaction(p, a, id);
      await repo.revokeConsent(p, "consent-tunde", FIXTURE_NOW);
      return transaction;
    },
  };
  const tools = createReadTools({
    repository: repo,
    sources: [createFixtureDataSource({ repository: racing, clock })],
    clock,
  });
  const result = await tools.execute(fixtureOtherPrincipal, {
    protocolVersion: 1,
    callId: "in-flight",
    name: "get_transaction",
    args: { accountId: "tunde-current", transactionId: rows[0].id },
  });
  expect(result.data).toBeNull();
  expect(result.error?.code).toBe("CONSENT_REVOKED");
});

it("isolates context, validates selections, rejects stale writes and expires saved context", async () => {
  const first = (
    await repo.listTransactions(fixturePrincipal, "amina-current")
  )[0];
  state.selected!.transactionId = first.id;
  state.candidateSet = {
    resultId: "persisted-search",
    query: "Ada",
    filters: {
      accountIds: ["amina-current"],
      from: "2026-09-30T23:00:00Z",
      toExclusive: "2026-10-31T23:00:00Z",
    },
    candidates: [
      {
        accountId: first.accountId,
        transactionId: first.id,
        revision: first.revision,
      },
    ],
  };
  const store = createContextStore(fixturePrincipal, repo, () => FIXTURE_NOW);
  expect(await store.save("conversation-1", 0, state)).toBe(1);
  expect((await store.load("conversation-1"))?.state).toEqual(state);
  expect(
    await createContextStore(
      fixtureOtherPrincipal,
      repo,
      () => FIXTURE_NOW,
    ).load("conversation-1"),
  ).toBeNull();
  await expect(store.save("conversation-1", 0, state)).rejects.toMatchObject({
    status: 409,
  });
  const writes = await Promise.allSettled([
    store.save("conversation-1", 1, state),
    store.save("conversation-1", 1, state),
  ]);
  expect(writes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    store.save("bad-selection", 0, {
      ...state,
      selected: { accountId: "tunde-current", transactionId: "private-tunde" },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    await createContextStore(
      fixturePrincipal,
      repo,
      () => "2026-10-17T10:15:00.000Z",
    ).load("conversation-1"),
  ).toBeNull();
  const d = await db();
  await d.execute(
    sql`UPDATE fm_transactions SET payload=jsonb_set(payload, '{revision}', '2') WHERE id=${first.id}`,
  );
  await expect(store.load("conversation-1")).rejects.toMatchObject({
    code: "SNAPSHOT_EXPIRED",
  });
});

it("checks consent scopes and expiry, persists revocation and invalidates saved context", async () => {
  const d = await db();
  await d.execute(
    sql`UPDATE fm_consents SET payload=jsonb_set(payload, '{scopes}', '["accounts:read"]') WHERE id='consent-amina'`,
  );
  const tx = (
    await repo.listTransactions(fixturePrincipal, "amina-current")
  )[0];
  expect(
    (
      await POST(
        req(
          call("get_transaction", {
            accountId: "amina-current",
            transactionId: tx.id,
          }),
        ),
      )
    ).status,
  ).toBe(403);
  await d.execute(
    sql`UPDATE fm_consents SET payload=jsonb_set(payload, '{scopes}', '["accounts:read","transactions:read","evidence:read"]') WHERE id='consent-amina'`,
  );
  const expired = createReadTools({
    repository: repo,
    sources: [createFixtureDataSource({ repository: repo })],
    clock: () => "2027-01-01T00:00:00.000Z",
  });
  expect((await expired.dispatch(fixturePrincipal, call())).error?.code).toBe(
    "CONSENT_EXPIRED",
  );
  await repo.revokeConsent(
    fixturePrincipal,
    "consent-amina",
    new Date().toISOString(),
  );
  expect((await POST(req(call()))).status).toBe(403);
  expect((await GET(req())).status).toBe(403);
  expect(
    (
      await createDurableRepository().getConsent(
        fixturePrincipal,
        "consent-amina",
      )
    )?.state,
  ).toBe("revoked");
  await expect(
    createContextStore(fixturePrincipal, repo, () => FIXTURE_NOW).load(
      "conversation-1",
    ),
  ).rejects.toMatchObject({ code: "CONSENT_REVOKED" });
  const old = await readState();
  expect(old.batches).toHaveLength(0);
  await logout(req());
  expect((await POST(req(call()))).status).toBe(401);
});
