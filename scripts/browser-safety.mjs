/* global document: readonly, Event: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "financial-browser-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const base = "http://localhost:3101";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3101",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      PAYMENT_MODE: "fixture",
      PAYSTACK_SECRET_KEY: "",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      OPERATOR_ID: "browser-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      APP_ORIGIN: base,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  });
  const reviewSession = await browser.newContext();
  const editSession = await browser.newContext();
  // Restrict both browser contexts to the local fixture application.
  for (const context of [reviewSession, editSession])
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
  const post = async (path, data) => {
    const response = await editSession.request.post(`${base}/api/${path}`, {
      data,
      headers: { Origin: base },
    });
    assert.ok(
      response.ok(),
      `${path}: ${response.status()} ${await response.text()}`,
    );
    return response.json();
  };
  await post("session", { password });
  const initial = {
    name: "Ada",
    bankCode: "035",
    accountNumber: "0000000001",
    amountKobo: 50000,
    reason: "Initial review",
  };
  const draft = await post("batches", { payments: [initial] });
  await post(`batches/${draft.id}/verify`, {});
  const page = await reviewSession.newPage();
  await page.clock.install();
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Payment jobs" })
    .click();
  const card = page.locator(".batch-card");
  const acknowledgment = card.getByRole("checkbox");
  const approvalPassword = card.getByLabel(
    "Password to approve reviewed batch",
  );
  const approve = card.getByRole("button", { name: "Approve reviewed batch" });
  await acknowledgment.waitFor();
  const poll = async () => {
    const response = page.waitForResponse(
      (r) => r.url() === `${base}/api/state` && r.request().method() === "GET",
    );
    await page.clock.fastForward(21000);
    const snapshot = await (await response).json();
    await page.waitForFunction(
      (reference) =>
        document.querySelector(".batch-card")?.textContent.includes(reference),
      snapshot.batches[0].payments[0].reference,
    );
    return snapshot;
  };
  await acknowledgment.check();
  await approvalPassword.fill(password);
  await poll();
  assert.equal(
    await acknowledgment.isChecked(),
    true,
    "Unchanged polling preserves acknowledgment",
  );
  assert.equal(await approvalPassword.inputValue(), password);
  let instruction = initial;
  for (const patch of [
    { amountKobo: 100000 },
    { name: "Changed beneficiary" },
    { bankCode: "044", accountNumber: "0000000002" },
    { reason: "New payment purpose" },
  ]) {
    await acknowledgment.check();
    await approvalPassword.fill(password);
    const oldDigest = (
      await (await editSession.request.get(`${base}/api/state`)).json()
    ).batches[0].reviewDigest;
    instruction = { ...instruction, ...patch };
    await post(`batches/${draft.id}/edit`, { payments: [instruction] });
    await post(`batches/${draft.id}/verify`, {});
    const snapshot = await poll();
    assert.notEqual(snapshot.batches[0].reviewDigest, oldDigest);
    assert.equal(
      await acknowledgment.isChecked(),
      false,
      `Re-acknowledgment required for ${Object.keys(patch)}`,
    );
    assert.equal(
      await approvalPassword.inputValue(),
      "",
      "Changed review clears retained password",
    );
    assert.equal(await approve.isDisabled(), true);
    // Bypassing a disabled button still cannot reuse the old acknowledgment.
    let approvalCalls = 0;
    const observe = (request) => {
      if (request.url().endsWith("/approve")) approvalCalls++;
    };
    page.on("request", observe);
    await page
      .locator(".approval-form")
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    await page.clock.runFor(50);
    page.off("request", observe);
    assert.equal(approvalCalls, 0);
  }
  await acknowledgment.check();
  await approvalPassword.fill(password);
  const reviewed = (
    await (await editSession.request.get(`${base}/api/state`)).json()
  ).batches[0];
  const submitted = page.waitForRequest((r) => r.url().endsWith("/approve"));
  await approve.click();
  assert.equal(
    (await submitted).postDataJSON().reviewDigest,
    reviewed.reviewDigest,
  );
  await card
    .getByRole("button", { name: "Submit simulated transfers" })
    .waitFor();
  console.log(
    "PASS: two authenticated browser sessions; unchanged polling; amount, beneficiary, bank/account and reason changes clear acknowledgment/password; stale submit blocked; renewed review submits the acknowledged digest. Fixture mode only.",
  );
  // Isolated presentation assertion for the field populated by the fee adapter/persistence tests.
  await page.route(`${base}/api/state`, async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.batches[0].payments[0].providerFeeKobo = 1000;
    await route.fulfill({ response, json: state });
  });
  await poll();
  await page.getByText(/Confirmed fee:.*10\.00/).waitFor();
  console.log(
    "PASS: a confirmed 1,000-kobo fee renders as ₦10.00 in the payment card (controlled presentation response).",
  );
} catch (error) {
  console.error(output.slice(-6000));
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  await rm(dir, { recursive: true, force: true });
}
