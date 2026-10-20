import { clearTimeout } from "node:timers";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = await mkdtemp(join(tmpdir(), "agus-financial-http-"));
const base = "http://localhost:3116";
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const env = {
  ...process.env,
  DATABASE_URL: `pglite://${dir}`,
  PAYMENT_MODE: "fixture",
  PAYSTACK_SECRET_KEY: "",
  AI_PROVIDER: "none",
  AI_API_KEY: "",
  OPERATOR_ID: "financial-http-operator",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  APP_ORIGIN: base,
  NEXT_TELEMETRY_DISABLED: "1",
};
let child,
  browser,
  cookie = "",
  logs = "";
async function start(enabled = true) {
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      "3116",
      "--hostname",
      "127.0.0.1",
    ],
    {
      env: { ...env, FINANCIAL_DEMO_ENABLED: String(enabled) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b) => {
    logs += b;
  });
  child.stderr.on("data", (b) => {
    logs += b;
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Local production server did not start: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  await stopped;
  clearTimeout(timer);
}
async function request(path, body, options = {}) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: options.origin ?? base,
      ...(options.auth === false ? {} : { Cookie: cookie }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.headers.has("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return {
    status: response.status,
    data: await response.json(),
    cache: response.headers.get("cache-control"),
  };
}
const call = (name, args) => ({
  protocolVersion: 1,
  callId: "production-verification",
  name,
  args,
});
const range = {
  accountIds: ["amina-current"],
  from: "2026-09-30T23:00:00Z",
  toExclusive: "2026-10-31T23:00:00Z",
};
const search = { ...range, query: "", limit: 1, cursor: null };
try {
  await start();
  assert.equal((await request("financial-agent")).status, 401);
  assert.equal(
    (
      await request(
        "financial-agent",
        call("get_account_summary", { accountIds: ["amina-current"] }),
        { origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
  assert.equal((await request("session", { password })).status, 200);
  const accounts = await request("financial-agent");
  assert.equal(accounts.status, 200);
  assert.match(accounts.cache, /no-store/);
  assert.equal(accounts.data.simulation.simulated, true);
  assert.deepEqual(
    accounts.data.accounts.map((a) => a.accountId),
    ["amina-current", "amina-savings"],
  );
  assert.doesNotMatch(
    JSON.stringify(accounts.data),
    /tenantId|ownerId|consentId|artifactRef|rawRecordRef|tokenHash/,
  );
  const summary = await request(
    "financial-agent",
    call("get_account_summary", {
      accountIds: ["amina-current", "amina-savings"],
    }),
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.data.result.data.accounts[1].availableKobo, null);
  const total = await request(
    "financial-agent",
    call("calculate_spending", { ...range, groupBy: "month" }),
  );
  assert.equal(total.status, 200);
  assert.equal(total.data.result.data.expenseKobo, 1975151);
  assert.equal(total.data.result.data.incomeKobo, 25000000);
  const ambiguous = await request(
    "financial-agent",
    call("search_transactions", { ...search, query: "Ada", limit: 10 }),
  );
  assert.equal(ambiguous.status, 200);
  assert.equal(ambiguous.data.result.data.selection, "ambiguous");
  const detail = await request(
    "financial-agent",
    call("get_transaction", {
      accountId: "amina-current",
      transactionId: "ada-okafor-oct",
    }),
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.data.result.data.amountKobo, 500000);
  assert.doesNotMatch(
    JSON.stringify(detail.data),
    /tenantId|ownerId|consentId|artifactRef|rawRecordRef|providerAccountRef/,
  );
  const evidence = await request(
    "financial-agent",
    call("find_payment_evidence", {
      accountId: "amina-current",
      transactionId: "ada-okafor-oct",
    }),
  );
  assert.equal(evidence.status, 200);
  assert.equal(evidence.data.result.data.evidence[0].simulated, true);
  assert.doesNotMatch(
    JSON.stringify(evidence.data),
    /artifactRef|rawRecord|sha256/,
  );
  assert.equal(
    (
      await request(
        "financial-agent",
        call("get_transaction", {
          accountId: "tunde-current",
          transactionId: "private",
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request("financial-agent", {
        ...call("get_account_summary", { accountIds: ["amina-current"] }),
        actorId: "fictional-tunde",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("financial-agent", call("revokeConsent", {}))).status,
    400,
  );
  const first = await request(
    "financial-agent",
    call("search_transactions", search),
  );
  assert.ok(first.data.result.meta.nextCursor);
  const continuation = { ...search, cursor: first.data.result.meta.nextCursor };
  assert.equal(
    (
      await request(
        "financial-agent",
        call("search_transactions", continuation),
      )
    ).status,
    200,
  );
  const replay = await request(
    "financial-agent",
    call("search_transactions", continuation),
  );
  assert.equal(replay.data.result.error.code, "CURSOR_INVALID");
  const pending = await request(
    "financial-agent",
    call("search_transactions", search),
  );
  const oldCursor = pending.data.result.meta.nextCursor;

  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  });
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.locator("nav").waitFor();
  const browserResult = await page.evaluate(
    async (toolCall) => {
      const accountsResponse = await fetch("/api/financial-agent");
      const toolResponse = await fetch("/api/financial-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toolCall),
      });
      return {
        accountsStatus: accountsResponse.status,
        accounts: await accountsResponse.json(),
        toolStatus: toolResponse.status,
        tool: await toolResponse.json(),
      };
    },
    call("calculate_spending", { ...range, groupBy: "none" }),
  );
  assert.equal(browserResult.accountsStatus, 200);
  assert.equal(browserResult.toolStatus, 200);
  assert.equal(browserResult.tool.result.data.netKobo, 23024849);
  assert.equal(browserResult.accounts.simulation.simulated, true);
  await browser.close();
  browser = undefined;

  await stop();
  await start();
  assert.equal((await request("financial-agent")).status, 200); // Original session survives.
  const old = await request(
    "financial-agent",
    call("search_transactions", { ...search, cursor: oldCursor }),
  );
  assert.equal(old.data.result.error.code, "CURSOR_INVALID");
  const restored = await request(
    "financial-agent",
    call("calculate_spending", { ...range, groupBy: "none" }),
  );
  assert.equal(restored.data.result.data.expenseKobo, 1975151);
  await stop();
  await start(false);
  assert.equal((await request("financial-agent")).status, 503);
  assert.equal((await request("state")).status, 200);
  console.log(
    JSON.stringify({
      verdict: "PASS",
      checks: [
        "production HTTP authentication and origin",
        "five sanitized fixture tools",
        "account isolation and input rejection",
        "exact totals and ambiguous matches",
        "single-use cursor replay",
        "authenticated browser fetch",
        "session/data restart and cursor invalidation",
        "opt-in disabled while payment state remains available",
      ],
      externalProviderCalls: 0,
    }),
  );
} finally {
  if (browser) await browser.close();
  await stop();
  await rm(dir, { recursive: true, force: true });
}
