/* global document: readonly, innerWidth: readonly, innerHeight: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const base = "http://localhost:3112";
const dir = await mkdtemp(join(tmpdir(), "agus-workspace-browser-"));
const evidence =
  process.env.WORKSPACE_SCREENSHOT_DIR ??
  join(process.cwd(), "docs/conversation-experience");
await mkdir(evidence, { recursive: true });
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-workspace.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3112",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "browser-mock-inference-only",
      OPERATOR_ID: "workspace-demo",
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
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (
        output.includes("Ready") &&
        (await fetch(`${base}/conversation`)).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* server is starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    let approvals = 0,
      executions = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/approve")) approvals++;
      if (r.url().endsWith("/execute")) executions++;
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    const fit = async () => {
      assert.deepEqual(
        await page.evaluate(() => {
          const c = document
            .querySelector(".agus-composer")
            .getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            composerVisible: c.bottom <= innerHeight && c.top >= 0,
          };
        }),
        { overflow: false, composerVisible: true },
      );
    };
    const nav = async () => {
      if (viewport.width <= 760) {
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        return page.getByRole("dialog").filter({
          has: page.getByRole("button", { name: "Close conversations" }),
        });
      }
      return page.getByRole("complementary");
    };
    const send = async (text) => {
      const n = await page.locator(".agus-assistant-message").count();
      await page.getByLabel("Message AGUS", { exact: true }).fill(text);
      await page.getByLabel("Message AGUS", { exact: true }).press("Enter");
      await page
        .getByRole("status")
        .filter({ hasText: "Thinking through" })
        .waitFor();
      await page.waitForFunction(
        (n) => document.querySelectorAll(".agus-assistant-message").length > n,
        n,
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".agus-composer").getAttribute("aria-busy") ===
          "false",
      );
      return page.locator(".agus-assistant-message").last();
    };
    await page.goto(`${base}/conversation`);
    await page
      .locator(".agus-signin-hint")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Sign in securely", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "See the bigger picture" })
      .waitFor();
    await fit();
    await page.screenshot({
      path: join(evidence, `welcome-${viewport.width}.png`),
    });
    await page.getByLabel("Message AGUS", { exact: true }).fill("Line one");
    await page.getByLabel("Message AGUS", { exact: true }).press("Shift+Enter");
    await page.getByLabel("Message AGUS", { exact: true }).press("L");
    assert.equal(
      await page.getByLabel("Message AGUS", { exact: true }).inputValue(),
      "Line one\nL",
    );
    const hello = await send(`Hey there from ${viewport.width}px`);
    assert.match(await hello.innerText(), /Hey!/);
    const firstUrl = page.url();
    await page.reload();
    await page.locator(".agus-assistant-message").waitFor();
    assert.match(
      await page.locator(".agus-user-message").innerText(),
      /Hey there/,
    );
    let sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "New chat", exact: false })
      .click();
    const education = await send("Explain inflation in simple terms");
    assert.match(await education.innerText(), /purchasing power/);
    const secondUrl = page.url();
    sidebar = await nav();
    await sidebar
      .getByRole("button", {
        name: `Hey there from ${viewport.width}px`,
        exact: true,
      })
      .first()
      .click();
    await page.locator(".agus-assistant-message").waitFor();
    assert.equal(page.url(), firstUrl);
    await page.goto(secondUrl);
    await page.locator(".agus-assistant-message").waitFor();
    await page.locator(".agus-account-picker>summary").click();
    await page
      .getByRole("button", { name: "Load authorized accounts", exact: true })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page.locator(".agus-account-picker>summary").click();
    const total = await send("Show my spending for October 2026");
    assert.match(await total.innerText(), /₦19,751.51/);
    await page.getByLabel("Financial totals").waitFor();
    await total.locator(".agus-sources>summary").click();
    assert.match(await total.innerText(), /fixture\/fixture/);
    await fit();
    await page.screenshot({
      path: join(evidence, `financial-${viewport.width}.png`),
    });
    const matches = await send("Find payments to Ada in October 2026");
    assert.match(await matches.innerText(), /2 candidate/);
    await page
      .getByRole("button", { name: "First candidate", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("Message AGUS", { exact: true }).inputValue(),
      "Show details for the first candidate",
    );
    await fit();
    await page.screenshot({
      path: join(evidence, `matches-${viewport.width}.png`),
    });
    sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "Explore AGUS plans", exact: false })
      .click();
    const plans = page.getByRole("dialog").filter({
      has: page.getByRole("button", { name: "Close plans", exact: true }),
    });
    await plans
      .getByRole("heading", { name: "Personal Plus", exact: true })
      .waitFor();
    assert.match(await plans.innerText(), /Usage is not metered/);
    await page.screenshot({
      path: join(evidence, `plans-${viewport.width}.png`),
    });
    await page
      .getByRole("button", { name: "Close plans", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    assert.ok(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("agus-plan-link"),
      ),
    );
    if (viewport.width <= 760) await page.keyboard.press("Escape");
    // A recoverable network failure retains the input and exposes an accessible error.
    await page.route("**/api/conversation", (r) => r.abort());
    await page
      .getByLabel("Message AGUS", { exact: true })
      .fill("Keep this message");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "preserved" }).waitFor();
    assert.equal(
      await page.getByLabel("Message AGUS", { exact: true }).inputValue(),
      "Keep this message",
    );
    await page.unroute("**/api/conversation");
    const handoff = await send(
      "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
    );
    assert.match(await handoff.innerText(), /editable draft/);
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    await handoff
      .getByRole("button", { name: "Continue in payment draft", exact: false })
      .click();
    await page.waitForURL(`${base}/`);
    await page.locator(".proposal-summary").last().waitFor();
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    await page.goto(secondUrl);
    await page.locator(".agus-assistant-message").first().waitFor();
    let lateRoute, lateResponse;
    let captured;
    const capture = new Promise((resolve) => {
      captured = resolve;
    });
    await page.route("**/api/conversations", async (route) => {
      lateResponse = await route.fetch();
      lateRoute = route;
      captured();
    });
    await send("Hey, one more idea");
    await capture;
    sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await page.locator(".agus-signin-hint").waitFor();
    const delivered = page.waitForResponse(
      (response) => response.url() === `${base}/api/conversations`,
    );
    await lateRoute.fulfill({ response: lateResponse });
    await delivered;
    await page.waitForTimeout(150);
    await page.locator(".agus-signin-hint").waitFor();
    assert.equal(await page.locator(".agus-history>button:visible").count(), 0);
    assert.equal(await page.locator(".agus-assistant-message").count(), 0);
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      passed: true,
      checks: [
        "welcome",
        "keyboard Enter and Shift+Enter",
        "dialog Escape and focus restoration",
        "authenticated server history",
        "reload",
        "new chat and switching",
        "education",
        "deterministic financial totals",
        "source attribution",
        "clarification choices",
        "plan preview",
        "recoverable error",
        "safe payment draft handoff",
        "sign out clears visible history",
        "late authenticated responses cannot restore signed-out history",
        "no overflow",
        "composer visible",
      ],
      inference: "mocked Gemini transport",
      payments: "fictional fixture; no approval/execution invoked",
    });
    console.log(`PASS ${viewport.width}px workspace`);
    await context.close();
  }
  await writeFile(
    join(evidence, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once("exit", r),
  );
  await rm(dir, { recursive: true, force: true });
}
