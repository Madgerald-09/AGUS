/* global document: readonly, innerWidth: readonly, innerHeight: readonly, getComputedStyle: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const base = "http://localhost:3104";
const evidence =
  process.env.CONVERSATION_SCREENSHOT_DIR ??
  join(process.cwd(), "docs/integration");
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
});
const results = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000, name: "desktop" },
    { width: 820, height: 900, name: "narrow-desktop" },
    { width: 390, height: 844, name: "mobile-390" },
    { width: 320, height: 740, name: "mobile-320" },
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "integration-conversation-"));
    const password = randomBytes(24).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const child = spawn(
      process.execPath,
      [
        "--import",
        "./scripts/fixtures/gemini-conversation.mjs",
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        "3104",
        "--hostname",
        "127.0.0.1",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: `pglite://${dir}`,
          PAYMENT_MODE: "fixture",
          PAYSTACK_SECRET_KEY: "",
          AI_PROVIDER: "gemini",
          AI_API_KEY: "browser-mock-inference-only",
          OPERATOR_ID: "integration-operator",
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
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(ready, output);
      context = await browser.newContext({
        viewport,
        isMobile: viewport.width < 700,
        hasTouch: viewport.width < 700,
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        route.request().url().startsWith(base)
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let approvals = 0,
        executions = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/approve")) approvals++;
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
      const send = async (message) => {
        const count = await page.locator(".message.assistant").count();
        await composer.fill(message);
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "Thinking…" })
          .waitFor();
        assert.ok(
          (await page.locator(".message.user").last().innerText()).includes(
            message,
          ),
          "user message appears immediately",
        );
        await page.waitForFunction(
          (n) => document.querySelectorAll(".message.assistant").length > n,
          count,
        );
        await idle();
        return page.locator(".message.assistant").last().innerText();
      };
      const fit = async () => {
        const g = await page.evaluate(() => {
          const composer = document
            .querySelector(".composer")
            .getBoundingClientRect();
          const conversation = document.querySelector(".conversation");
          const replies = document.querySelectorAll(".message.assistant");
          return {
            overflow:
              document.documentElement.scrollWidth > innerWidth ||
              conversation.scrollWidth > conversation.clientWidth + 1,
            visible: composer.bottom <= innerHeight && composer.top >= 0,
            black: getComputedStyle(document.body).backgroundColor,
            animation: getComputedStyle(replies.item(replies.length - 1))
              .animationName,
          };
        });
        assert.deepEqual(g, {
          overflow: false,
          visible: true,
          black: "rgb(0, 0, 0)",
          animation: "none",
        });
      };
      assert.match(await send("Hey."), /Hey!/);
      assert.match(
        await send("What can you help me with?"),
        /one or several recipients/,
      );
      assert.match(
        await send("How much did I spend on food?"),
        /fictional demonstration ledger/,
      );
      assert.match(
        await send("I don't understand. Explain that."),
        /fictional sample ledger/,
      );
      await fit();
      await page.screenshot({
        path: join(evidence, `${viewport.name}-conversation.png`),
      });
      await send(
        "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
      );
      const summary = page.locator(".proposal-summary").last();
      assert.equal(
        await summary.getAttribute("open"),
        null,
        "proposal starts compact",
      );
      assert.ok(
        (await summary.boundingBox()).height < 160,
        "compact summary height",
      );
      await fit();
      await page.screenshot({
        path: join(evidence, `${viewport.name}-compact-proposal.png`),
      });
      await summary.locator(":scope > summary").click();
      const proposal = page.locator(".proposal-card").last();
      assert.equal(
        await proposal
          .getByLabel("Account number", { exact: true })
          .inputValue(),
        "",
        "invented mock account discarded",
      );
      assert.equal(
        await proposal.getByLabel("Amount (NGN)", { exact: true }).inputValue(),
        "500",
      );
      await proposal.getByLabel("Fictional recipient 1").focus();
      await proposal
        .getByLabel("Fictional recipient 1")
        .selectOption("0000000001");
      const persisted = page.waitForResponse(
        (r) =>
          r.url().includes("/api/proposals/") &&
          r.request().postDataJSON()?.proposals[0]?.accountNumber ===
            "0000000001",
      );
      await proposal.getByLabel("Description", { exact: true }).click();
      assert.equal((await persisted).status(), 200);
      await page.reload();
      await composer.waitFor();
      await page.locator(".proposal-summary > summary").last().click();
      assert.equal(
        await proposal
          .getByLabel("Account number", { exact: true })
          .inputValue(),
        "0000000001",
        "editable draft persists",
      );
      await proposal
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await proposal.waitFor({ state: "detached" });
      await idle();
      const batchSummary = page
        .locator(".compact-payment:not(.proposal-summary)")
        .last();
      assert.equal(await batchSummary.getAttribute("open"), null);
      await fit();
      await page.screenshot({
        path: join(evidence, `${viewport.name}-compact-payment.png`),
      });
      await batchSummary.locator(":scope > summary").click();
      const card = page.locator(".batch-card").last();
      assert.equal(approvals, 0);
      assert.equal(executions, 0);
      await card
        .getByRole("button", { name: "Verify beneficiaries", exact: true })
        .click();
      await card.getByRole("checkbox").check();
      await card
        .getByLabel("Password to approve reviewed batch")
        .fill(password);
      await card
        .getByRole("button", { name: "Approve reviewed batch", exact: true })
        .click();
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .waitFor();
      assert.equal(executions, 0);
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .click();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .click();
      await card.locator(".payment-row .badge.successful").waitFor();
      assert.equal(approvals, 1);
      assert.equal(executions, 1);
      await batchSummary.locator(":scope > summary").click();
      assert.match(
        await send("What happened to the payments I prepared earlier?"),
        /successful/,
      );
      assert.match(await send("Thanks."), /You’re welcome/);
      await fit();
      await page.screenshot({
        path: join(evidence, `${viewport.name}-completed-conversation.png`),
      });
      const state = await (
        await context.request.get(`${base}/api/state`)
      ).json();
      assert.equal(
        JSON.stringify(state).includes("browser-mock-inference-only"),
        false,
        "API key stays server-side",
      );
      assert.equal(state.batches[0].payments[0].status, "successful");
      assert.ok(state.batches[0].approval.consumedAt);
      assert.deepEqual(errors, []);
      results.push({
        viewport,
        inference: "mocked Gemini transport; no live credentials",
        payment: "fixture simulation",
        messages: state.messages.length,
        passed: true,
      });
      console.log(
        `PASS ${viewport.name}: required conversation, compact details, persisted edits and authenticated simulated payment`,
      );
    } finally {
      await context?.close();
      child.kill("SIGTERM");
      await new Promise((r) =>
        child.exitCode !== null ? r() : child.once("exit", r),
      );
      await rm(dir, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(evidence, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
