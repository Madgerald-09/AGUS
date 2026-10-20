// One-shot real Gemini + real Next.js + real Chromium browser acceptance.
// Executed only on disposable GitHub validation branch; no external fixture inference preload.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "http://127.0.0.1:3133";
const temp = await mkdtemp(join(tmpdir(), "agus-genuine-browser-"));
const secretPassword = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const result = { candidate: "eb38071", mode: "fixture", provider: "gemini",
  model: "gemini-3.5-flash-lite", checks: [], apiCalls: 0, apiResponses: [],
  transferExecutionRequests: 0, verdict: "BLOCKED" };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (answer) => String(answer || "").replace(/\s+/g, " ").slice(0, 210);
const env = {
  ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
  APP_ORIGIN: origin, DATABASE_URL: "pglite://" + temp,
  OPERATOR_ID: "isolated-genuine-browser",
  OPERATOR_PASSWORD_HASH: salt + ":" + scryptSync(secretPassword, salt, 64).toString("hex"),
  PAYMENT_MODE: "fixture", FINANCIAL_DEMO_ENABLED: "true",
  AI_PROVIDER: "gemini", AI_MODEL: "gemini-3.5-flash-lite",
  PAYSTACK_SECRET_KEY: "", PAYSTACK_TRANSFERS_ENABLED: "false",
  LIVE_TRANSFERS_ENABLED: "false", LIVE_OWNER_AUTHORIZED: "false",
  LIVE_WEBHOOK_VALIDATED: "false", LIVE_RECONCILIATION_VALIDATED: "false",
  PAYMENTS_EMERGENCY_DISABLED: "true",
  AGUS_MAX_GEMINI_CALLS: "18",
};
assert.ok(env.AI_API_KEY, "Gemini secret missing from protected runner environment");
const child = spawn(process.execPath, [
  "--import", "./scripts/validation/genuine-gemini-budget.mjs",
  "node_modules/next/dist/bin/next", "start",
  "--hostname", "127.0.0.1", "--port", "3133",
], { env, stdio: ["ignore", "pipe", "pipe"] });
let startup = "", browser, context, page;
const collect = (buff) => {
  const str = String(buff);
  for (const line of str.split(/\r?\n/)) {
    const match = line.match(/AGUS_GEMINI_REQUEST_START (\d+)\/18/);
    if (match) result.apiCalls = Math.max(result.apiCalls, Number(match[1]));
    if (line.includes("AGUS_GEMINI_HARD_CALL_LIMIT")) result.budgetExceeded = true;
  }
  startup = (startup + str).slice(-6000);
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);
let completed = false;
async function responseTurn(response) {
  const status = response.status();
  const json = await response.json();
  const reply = json.reply || {};
  const evidence = reply.evidence || {};
  result.apiResponses.push({
    status, kind: reply.kind ?? null, modelCalls: evidence.modelCalls ?? 0,
    toolCalls: evidence.toolCalls ?? 0,
    narration: reply.presentation?.narration ?? "none",
    narrationCode: evidence.narrationCode ?? null,
    errorCode: evidence.code ?? null, accountAction: reply.accountAction ?? null,
    citationCount: Array.isArray(reply.citations) ? reply.citations.length : 0,
    excerpt: reply.kind === "general" ? safe(reply.text) : undefined,
  });
  assert.equal(status, 200, "Conversation did not return HTTP 200 (kind " + reply.kind + ")");
  assert.ok(evidence.modelCalls > 0, "No genuine model calls reported");
  assert.notEqual(reply.kind, "unavailable", "AI unavailable rather than model-assisted");
  await page.waitForFunction(() =>
    document.querySelector(".agus-composer")?.getAttribute("aria-busy") === "false",
    null, { timeout: 12000 });
  return reply;
}
function awaitConversation() {
  return page.waitForResponse((res) =>
    new URL(res.url()).pathname === "/api/conversation" &&
    res.request().method() === "POST", { timeout: 90000 });
}
async function send(text) {
  await page.getByLabel("Message AGUS", { exact: true }).fill(text);
  const response = awaitConversation();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  return responseTurn(await response);
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(origin + "/conversation");
      if (r.ok) { ready = true; break; }
    } catch { /* process starting */ }
    await wait(200);
  }
  assert.ok(ready, "Production server did not become ready");
  result.checks.push("Production Next.js server started using Gemini, isolated database and fixture-only payment configuration");
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const browserErrors = [];
  page.on("pageerror", (e) => browserErrors.push(e.name ?? "Error"));
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (/\/(?:batches\/[^/]+\/execute|proposals\/[^/]+\/approve)(?:\?|$)/.test(r.url()))
      result.transferExecutionRequests += 1;
  });
  await page.goto(origin + "/conversation", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Let's talk money.", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open conversations", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).filter({ visible: true }).click();
  await page.getByLabel("Operator password", { exact: true }).fill(secretPassword);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".agus-signin").waitFor({ state: "hidden", timeout: 15000 });
  await page.getByLabel("Message AGUS", { exact: true }).waitFor();
  result.checks.push("Authenticated real Chromium conversation UI without model mocks");
  const edu = await send("What is inflation?");
  assert.equal(edu.kind, "general");
  assert.equal(edu.evidence.toolCalls, 0);
  result.checks.push("Genuine educational reply without financial tool access");
  const everyday = await send("Help me write a short thank-you note to a friend.");
  assert.equal(everyday.kind, "general");
  assert.equal(everyday.evidence.toolCalls, 0);
  result.checks.push("Genuine everyday conversation through the same saved chat");
  const historical = "Did I transfer money to Musa last week?";
  const choose = await send(historical);
  assert.equal(choose.kind, "clarify", "Historical transfer question should clarify account choice");
  assert.equal(choose.accountAction, "choose_demo_account", "Missing account must not be inferred");
  assert.equal(choose.handoff, undefined, "Historical question must never become a new payment draft");
  await page.getByRole("button", { name: "Choose demo account", exact: true }).last().click();
  await page.getByRole("dialog", { name: "Account", exact: true }).waitFor();
  await page.getByLabel("Account (optional)").selectOption("amina-current");
  const follow = awaitConversation();
  await page.getByRole("button", { name: "Continue question", exact: true }).click();
  const checked = await responseTurn(await follow);
  assert.ok(["clarify", "financial"].includes(checked.kind), "Selected historical payment routed incorrectly");
  assert.equal(checked.handoff, undefined);
  assert.doesNotMatch(checked.text, /confirmed recipient bank credit/i);
  result.checks.push("Historical-payment question offered authorized account picker and safely resumed without drafting a transfer");
  const totals = await send("Calculate my spending and income for amina-current for the full calendar month of October 2026, Africa/Lagos.");
  assert.equal(totals.kind, "financial");
  for (const expected of ["₦19,751.51", "₦250,000.00", "₦230,248.49"])
    assert.ok(totals.text.includes(expected), "Required server-computed total missing");
  assert.ok(totals.citations.length > 0, "Financial totals have no source citations");
  result.totalsNarration = totals.presentation?.narration ?? "none";
  result.totalsNarrationCode = totals.evidence.narrationCode ?? null;
  result.checks.push("Account-scoped fictional totals, correct server arithmetic and source citations; narration mode recorded");
  const payment = await send("Prepare a payment of 500 naira to Ada.");
  assert.equal(payment.kind, "handoff", "Natural-language payment preparation not routed as handoff");
  assert.equal(payment.handoff?.kind, "existing_payment_draft");
  const draftButton = page.getByRole("button", { name: "Prepare payment draft", exact: true }).last();
  await draftButton.waitFor();
  const draftResponse = page.waitForResponse((res) =>
    new URL(res.url()).pathname === "/api/conversation/payment-draft" &&
    res.request().method() === "POST", { timeout: 30000 });
  await draftButton.click();
  assert.equal((await draftResponse).status(), 200, "Fixture draft preparation failed");
  const card = page.locator(".agus-thread .agus-payment").last();
  await card.waitFor({ timeout: 15000 });
  await card.locator("summary").first().click();
  const amount = await card.getByLabel("Amount (NGN)", { exact: true }).first().inputValue();
  assert.equal(amount, "500", "Unverified editable draft amount incorrect");
  result.checks.push("Real AI payment handoff created an editable fictional draft; no approval or submission");
  const savedMessages = await page.locator(".agus-assistant-message").count();
  assert.ok(savedMessages >= 5);
  const savedUrl = page.url();
  assert.ok(savedUrl.includes("?chat="), "Saved conversation URL not established");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".agus-assistant-message").last().waitFor();
  assert.equal(await page.locator(".agus-assistant-message").count(), savedMessages);
  result.checks.push("Signed-in conversation persisted and reopened after browser reload");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByLabel("Message AGUS", { exact: true }).isVisible(), true);
  result.checks.push("Mobile-width composer visible with persisted real-AI conversation");
  assert.equal(result.transferExecutionRequests, 0, "Unexpected transfer approval or execution request");
  assert.equal(browserErrors.length, 0, "Browser JavaScript errors observed");
  result.verdict = result.totalsNarration === "ai" ? "PASS" : "PASS_WITH_NARRATION_FALLBACK";
  completed = true;
} catch (error) {
  result.verdict = "BLOCKED";
  result.failure = (error instanceof Error ? error.message : String(error)).slice(0, 280);
  process.exitCode = 1;
} finally {
  result.checksCount = result.checks.length;
  result.secretExposed = false;
  result.browserErrors = typeof page === "undefined" || !page ? undefined : undefined;
  // Keep only sanitized metadata: never log raw requests, server logs, cookies or credentials.
  console.log("AGUS_GENUINE_BROWSER_RESULT " + JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const report = [
      "## AGUS genuine-model production browser acceptance",
      "Verdict: " + result.verdict,
      "Actual Gemini API request starts: " + result.apiCalls + " / 18 maximum.",
      "Scenario metadata: " +
        JSON.stringify(
          result.apiResponses.map((response) =>
            Object.fromEntries(
              Object.entries(response).filter(([key]) => key !== "excerpt"),
            ),
          ),
        ),
      "Checks: " + result.checks.join("; "),
      "No live banking, no transfer approval or execution, no credential disclosure.",
      "Physical microphone and OS speech/clipboard still require device tests.",
    ].join("\n\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  child.kill("SIGTERM");
  await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once("exit", resolve); setTimeout(resolve, 2500); }});
  await rm(temp, { recursive: true, force: true });
}
if (!completed) process.exitCode = 1;