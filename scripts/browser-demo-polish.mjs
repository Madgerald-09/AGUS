/* global document: readonly, innerWidth: readonly, innerHeight: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const base = "http://localhost:3107";
const evidence =
  process.env.DEMO_POLISH_SCREENSHOT_DIR ?? "/tmp/agus-demo-polish";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
});
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "agus-polish-"));
    const password = randomBytes(24).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        "3107",
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
          OPERATOR_ID: "polish-browser",
          OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
          APP_ORIGIN: base,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    let context;
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if (output.includes("Ready") && (await fetch(base)).ok) {
            ready = true;
            break;
          }
        } catch {
          /* starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.ok(ready, output);
      context = await browser.newContext({
        viewport,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
        reducedMotion: "reduce",
      });
      let bankRequests = 0;
      await context.route("**/*", (route) => {
        if (!route.request().url().startsWith(base)) return route.abort();
        if (
          route.request().url() === `${base}/api/banks` &&
          bankRequests++ === 0
        )
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Provider temporarily unavailable" }),
          });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      let executions = 0;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.url().endsWith("/execute")) executions++;
      });
      await page.goto(base);
      await page
        .getByLabel("Operator password", { exact: true })
        .fill(password);
      await page.getByRole("button", { name: "Sign in securely" }).click();
      const composer = page.getByLabel("Message Agus");
      await composer.waitFor();
      const idle = () =>
        page.waitForFunction(
          () =>
            document.querySelector(".composer")?.getAttribute("aria-busy") ===
              "false" && !document.querySelector(".request-progress"),
        );
      const send = async (text) => {
        const count = await page.locator(".message.assistant").count();
        await composer.fill(text);
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
        await page.waitForFunction(
          (n) => document.querySelectorAll(".message.assistant").length > n,
          count,
        );
        await idle();
        return page.locator(".message.assistant").last().innerText();
      };
      const openProposal = async () => {
        const details = page.locator(".proposal-summary").last();
        await details.locator(":scope > summary").click();
        return details;
      };
      assert.match(await send("Hi Agus"), /I’m Agus/);
      await send("Help me send ₦500 to my Wema account.");
      let proposal = await openProposal();
      assert.equal(
        await proposal
          .getByLabel("Recipient label", { exact: true })
          .inputValue(),
        "My account",
      );
      await proposal
        .getByRole("button", { name: "Retry bank loading" })
        .click();
      await proposal
        .getByLabel("Bank", { exact: true })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.querySelector('select[aria-label="Bank"]')?.options.length >
          1,
      );
      assert.equal(
        await proposal.getByLabel("Bank", { exact: true }).inputValue(),
        "035",
      );
      assert.match(
        await send("OPay bank naw."),
        /isn’t in the available bank list/,
      );
      await send("Change the bank to Access.");
      proposal = await openProposal();
      assert.equal(
        await proposal.getByLabel("Bank", { exact: true }).inputValue(),
        "044",
      );
      assert.equal(
        await proposal
          .getByLabel("Recipient label", { exact: true })
          .inputValue(),
        "My account",
      );
      await send("Make it ₦700.");
      await send("account: 0000000002");
      assert.equal(await page.locator(".batch-card").count(), 1);
      const card = page.locator(".batch-card");
      await page.locator(".linked-batch .compact-payment > summary").click();
      assert.match(await card.innerText(), /Recipient label: My account/);
      await card
        .getByRole("button", { name: "Verify beneficiaries", exact: true })
        .click();
      await idle();
      assert.match(await card.innerText(), /CHIDI NWOSU/);
      assert.match(await card.innerText(), /Recipient label: My account/);
      await card.getByRole("checkbox").check();
      await card
        .getByLabel("Password to approve reviewed batch")
        .fill(password);
      await card
        .getByRole("button", { name: "Approve reviewed batch", exact: true })
        .click();
      await idle();
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .waitFor();
      assert.equal(executions, 0, "approval does not submit");
      await card.locator(".workflow-guide > summary").click();
      assert.match(
        await card.locator(".workflow-steps .current").innerText(),
        /Submit separately/,
      );
      await card.screenshot({
        path: join(evidence, `${viewport.width}-review.png`),
      });
      await send("Make it ₦900.");
      assert.equal(
        await page.locator(".batch-card").count(),
        1,
        "one current card per linked batch",
      );
      await page.locator(".linked-batch .compact-payment > summary").click();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Submit simulated transfers",
            exact: true,
          })
          .count(),
        0,
      );
      const state = await (
        await context.request.get(`${base}/api/state`)
      ).json();
      assert.equal(state.batches.length, 1);
      assert.equal(state.batches[0].approval, undefined);
      assert.equal(state.batches[0].payments[0].verifiedName, undefined);
      assert.equal(state.batches[0].payments[0].amountKobo, 90000);
      await page
        .getByRole("button", { name: "Edit instructions", exact: true })
        .click();
      const editor = page.getByRole("region", { name: "Edit payment details" });
      await editor.waitFor();
      assert.equal(
        await editor.getByLabel("Bank", { exact: true }).inputValue(),
        "044",
      );
      const fit = await page.evaluate(() => {
        const conversation = document.querySelector(".conversation");
        const composer = document
          .querySelector(".composer")
          .getBoundingClientRect();
        return {
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            conversation.scrollWidth > conversation.clientWidth + 1,
          composerVisible: composer.top >= 0 && composer.bottom <= innerHeight,
        };
      });
      assert.deepEqual(fit, { overflow: false, composerVisible: true });
      await page.screenshot({
        path: join(evidence, `${viewport.width}-editing.png`),
      });
      assert.deepEqual(errors, []);
      assert.equal(executions, 0);
      console.log(
        `PASS ${viewport.width}: greetings, corrections, bank retry, separate approval, invalidation, current card and layout (fixture only)`,
      );
    } finally {
      await context?.close();
      child.kill("SIGTERM");
      await new Promise((resolve) =>
        child.exitCode !== null ? resolve() : child.once("exit", resolve),
      );
      await rm(dir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
