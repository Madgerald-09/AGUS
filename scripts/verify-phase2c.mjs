/* global document: readonly */
import assert from "node:assert/strict";
import { clearTimeout } from "node:timers";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = await mkdtemp(join(tmpdir(), "agus-phase2c-e2e-"));
const evidence =
  process.env.PHASE2C_SCREENSHOT_DIR || "/tmp/agus-phase2c-evidence";
await mkdir(evidence, { recursive: true });
const base = "http://localhost:3117";
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const env = {
  ...process.env,
  DATABASE_URL: `pglite://${dir}`,
  PAYMENT_MODE: "fixture",
  PAYSTACK_SECRET_KEY: "",
  FINANCIAL_DEMO_ENABLED: "true",
  AI_PROVIDER: "gemini",
  AI_MODEL: "scripted-fixture-only",
  AI_API_KEY: "browser-mock-inference-only",
  OPERATOR_ID: "phase2c-browser",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  APP_ORIGIN: base,
  NEXT_TELEMETRY_DISABLED: "1",
};
let child,
  browser,
  output = "";
async function start(configured = true) {
  child = spawn(
    process.execPath,
    [
      ...(configured
        ? ["--import", "./scripts/fixtures/financial-conversation.mjs"]
        : []),
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      "3117",
      "--hostname",
      "127.0.0.1",
    ],
    {
      env: {
        ...env,
        ...(!configured ? { AI_PROVIDER: "none", AI_API_KEY: "" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server failed to start: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  await done;
  clearTimeout(timer);
}
try {
  await start();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  });
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const errors = [],
    mutations = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (/\/(?:approve|execute|otp|verify|reconcile)$/.test(req.url()))
      mutations.push(req.url());
  });
  await page.goto(`${base}/conversation`);
  const message = page.getByLabel("Message", { exact: true });
  const button = page.getByRole("button", {
    name: "Send message",
    exact: true,
  });
  await message.fill("What is inflation?");
  await button.click();
  await page.getByRole("alert").filter({ hasText: "UNAUTHORIZED" }).waitFor();
  assert.equal(await message.inputValue(), "What is inflation?");
  const login = await context.request.post(`${base}/api/session`, {
    headers: { Origin: base },
    data: { password },
  });
  assert.equal(login.status(), 200);
  async function send(text) {
    await message.fill(text);
    const response = page.waitForResponse(
      (r) =>
        r.url() === `${base}/api/conversation` &&
        r.request().method() === "POST",
    );
    await button.click();
    const r = await response;
    const data = await r.json();
    await page.waitForFunction(
      () => !document.querySelector("#financial-message")?.disabled,
    );
    return { status: r.status(), ...data };
  }
  let result = await send("What is inflation?");
  assert.equal(result.status, 200);
  assert.equal(result.reply.kind, "general");
  assert.equal(result.reply.evidence.toolCalls, 0);
  assert.match(result.reply.text, /price level/);
  result = await send("What did I spend last month?");
  assert.equal(result.reply.kind, "clarify");
  assert.equal(result.reply.evidence.toolCalls, 0);
  await page.getByRole("button", { name: "Load authorized accounts" }).click();
  await page
    .locator('option[value="amina-current"]')
    .waitFor({ state: "attached" });
  await page.getByLabel("Account (optional)").selectOption("amina-current");
  result = await send("What did I spend in October 2026?");
  assert.equal(result.reply.kind, "financial");
  assert.match(result.reply.text, /₦19,751\.51/);
  assert.match(result.reply.text, /SIMULATED FICTIONAL DATA/);
  assert.equal(result.reply.evidence.toolCalls, 1);
  result = await send("Find Ada in October 2026");
  assert.equal(result.reply.kind, "clarify");
  assert.match(result.reply.text, /2 candidate/);
  await stop();
  await start();
  await page.reload();
  await page.getByRole("button", { name: "Load authorized accounts" }).click();
  await page
    .locator('option[value="amina-current"]')
    .waitFor({ state: "attached" });
  await page.getByLabel("Account (optional)").selectOption("amina-current");
  result = await send("The smaller one; show its evidence");
  assert.equal(result.reply.kind, "financial");
  assert.equal(result.reply.evidence.toolCalls, 2);
  assert.match(result.reply.text, /ada-okafor-oct/);
  assert.match(result.reply.text, /does not establish recipient bank credit/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /artifactRef|rawRecordRef|providerAccountRef/,
  );
  result = await send("Approve and submit my payment");
  assert.equal(result.reply.kind, "clarify");
  assert.equal(result.reply.evidence.toolCalls, 0);
  result = await send(
    "Prepare a payment to Ada; name: Ada; bank: 035; account: 0000000001; amount: 500",
  );
  assert.deepEqual(result.reply.handoff, { kind: "existing_payment_draft" });
  let state = await (await context.request.get(`${base}/api/state`)).json();
  assert.equal(state.batches.length, 0);
  await page.getByRole("button", { name: "Continue in payment draft" }).click();
  await page.waitForURL(`${base}/`);
  state = await (await context.request.get(`${base}/api/state`)).json();
  assert.ok(state.messages.some((m) => m.proposals?.length || m.batchId));
  assert.ok(
    state.batches.every(
      (b) => !["approved", "submitted", "successful"].includes(b.status),
    ),
  );
  assert.deepEqual(mutations, []);
  await page.goto(`${base}/conversation`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await message.isVisible());
    assert.ok(await button.isVisible());
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
    await page.screenshot({
      path: join(evidence, `phase2c-${width}.png`),
      fullPage: true,
    });
  }
  await stop();
  await start(false);
  result = await send("What is inflation?");
  assert.equal(result.status, 503);
  assert.equal(result.reply.evidence.code, "MODEL_NOT_CONFIGURED");
  assert.equal(await message.inputValue(), "What is inflation?");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        mockedTransport: true,
        genuineInference: false,
        checks: [
          "authentication",
          "education without account/tools",
          "personal account requirement",
          "authorized exact totals",
          "ambiguous search",
          "SQL context across process restart",
          "detail before evidence",
          "simulation and credit limitations",
          "execution refusal",
          "explicit editable-draft handoff",
          "no verification/approval/submission",
          "1440/390/320px",
          "MODEL_NOT_CONFIGURED with input preservation",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await stop();
  await rm(dir, { recursive: true, force: true });
}
