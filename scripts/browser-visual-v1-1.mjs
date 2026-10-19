/* global document: readonly, innerWidth: readonly, innerHeight: readonly, getComputedStyle: readonly */
// Two widths, no recording. Inference is explicitly mocked; sessions, SQL and financial facts are real fixture paths.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:3113";
const dataDir = await mkdtemp(join(tmpdir(), "agus-visual-v1-1-"));
const evidence = join(process.cwd(), "docs/visual-v1-1");
const capture = process.env.AGUS_CAPTURE_WELCOME === "true";
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const server = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-workspace.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3113",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dataDir}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "browser-mock-inference-only",
      OPERATOR_ID: "visual-review-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      APP_ORIGIN: base,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverOutput = "";
server.stdout.on("data", (b) => {
  serverOutput += b;
});
server.stderr.on("data", (b) => {
  serverOutput += b;
});
let browser;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (
        serverOutput.includes("Ready") &&
        (await fetch(`${base}/conversation`)).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* server starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, serverOutput);
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width === 390,
      hasTouch: viewport.width === 390,
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    let sends = 0,
      approvals = 0,
      executions = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/api/conversation")) sends++;
      if (request.url().endsWith("/approve")) approvals++;
      if (request.url().endsWith("/execute")) executions++;
    });
    await page.goto(`${base}/`);
    await page.locator(".agus-signin-trigger").waitFor();
    const input = page.getByLabel("Message AGUS", { exact: true });
    const fit = async () => {
      const geometry = await page.evaluate(() => {
        const composer = document
          .querySelector(".agus-composer")
          .getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          composerVisible: composer.top >= 0 && composer.bottom <= innerHeight,
          font: getComputedStyle(document.querySelector("#financial-message"))
            .fontSize,
        };
      });
      assert.deepEqual(geometry, {
        overflow: false,
        composerVisible: true,
        font: "16px",
      });
    };
    const nav = async () => {
      if (viewport.width === 390) {
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        return page.locator(".agus-drawer");
      }
      if (!(await page.locator(".agus-sidebar").isVisible()))
        await page
          .getByRole("button", { name: "Expand navigation", exact: true })
          .click();
      return page.locator(".agus-sidebar");
    };
    const send = async (text) => {
      const count = await page.locator(".agus-assistant-message").count();
      await input.fill(text);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".agus-assistant-message").length > count,
        count,
      );
      await page.waitForFunction(
        () =>
          document.querySelector(".agus-composer").getAttribute("aria-busy") ===
          "false",
      );
      return page.locator(".agus-assistant-message").last();
    };
    await fit();
    assert.equal(
      await page.locator(".agus-suggestions button:visible").count(),
      viewport.width === 390 ? 3 : 4,
    );
    assert.equal(await page.locator(".agus-composer-note").count(), 0);
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.id),
      "financial-message",
    );
    if (capture) {
      assert.equal(
        await page.getByText("Original logo pending", { exact: true }).count(),
        0,
        "Original artwork is required before final screenshots",
      );
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(evidence, `welcome-${viewport.width}.png`),
      });
    }
    await input.fill("Keep my unsent question");
    await page
      .getByRole("button", { name: "Analyze spending", exact: true })
      .click();
    assert.equal(await input.inputValue(), "Keep my unsent question");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.locator(".agus-signin[open]").waitFor();
    assert.equal(sends, 0);
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page
      .locator(".agus-signin")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /^Account:/ }).waitFor();
    assert.equal(await input.inputValue(), "Keep my unsent question");
    assert.equal(sends, 0, "Sign-in must not automatically send");
    await send(`Hey there from ${viewport.width}px`);
    const firstUrl = page.url();
    await input.fill("Draft in saved chat");
    let sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await input.fill("Draft in new chat");
    sidebar = await nav();
    await sidebar
      .getByRole("button", {
        name: `Hey there from ${viewport.width}px`,
        exact: true,
      })
      .first()
      .click();
    await page.locator(".agus-assistant-message").waitFor();
    assert.equal(await input.inputValue(), "Draft in saved chat");
    if (viewport.width === 1440)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .click();
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page
      .locator("#agus-account option")
      .nth(1)
      .waitFor({ state: "attached" });
    await page.locator("#agus-account").selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const answer = await send("Show my spending for October 2026");
    assert.match(await answer.innerText(), /₦19,751\.51/);
    assert.match(await answer.innerText(), /₦250,000\.00/);
    assert.match(await answer.innerText(), /₦230,248\.49/);
    assert.match(await answer.innerText(), /Coverage is partial/);
    const disclosure = answer.locator(".agus-sources");
    assert.equal(await disclosure.getAttribute("open"), null);
    await disclosure.locator("summary").click();
    assert.match(await disclosure.innerText(), /Original response/);
    await page.reload();
    await page.locator(".agus-assistant-message").first().waitFor();
    assert.match(
      await page
        .getByRole("button", { name: /^Account:/ })
        .getAttribute("aria-label"),
      /No account/,
    );
    const handoff = await send(
      "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
    );
    await input.fill("Resume after payment review");
    await handoff.getByRole("button", { name: /Open payment draft/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.locator(".proposal-summary").last().waitFor();
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    await page
      .getByRole("link", { name: "Return to chat", exact: true })
      .click();
    await page.waitForURL(firstUrl);
    await page.locator(".agus-assistant-message").first().waitFor();
    assert.equal(await input.inputValue(), "Resume after payment review");
    await fit();
    assert.deepEqual(errors, []);
    results.push({ viewport, status: "passed", sends, approvals, executions });
    await context.close();
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "smoke-results.json"),
    JSON.stringify(
      {
        inference:
          "mocked routing and narration; real application sessions, SQL and fictional financial facts",
        screenshots: capture ? 2 : 0,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(dataDir, { recursive: true, force: true });
}
