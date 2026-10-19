/* global window: readonly, document: readonly, KeyboardEvent: readonly */
// Focused production integration journeys. Two sizes, no screenshots or audits.
import assert from "node:assert/strict";
import { URL } from "node:url";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const base = "http://127.0.0.1:3118";
const dir = await mkdtemp(join(tmpdir(), "agus-integration-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const report =
  process.env.INTEGRATION_REPORT ?? "/tmp/agus-browser-integration.json";
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-integration.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3118",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "integration-fixture-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      LIVE_TRANSFERS_ENABLED: "false",
      PAYMENTS_EMERGENCY_DISABLED: "false",
      AI_PROVIDER: "gemini",
      AI_MODEL: "scripted-fixture-only",
      AI_API_KEY: "browser-mock-inference-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  browser;
child.stdout.on("data", (b) => {
  output += b;
});
child.stderr.on("data", (b) => {
  output += b;
});
const results = [];
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
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 700,
      hasTouch: viewport.width < 700,
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    await context.addInitScript(() => {
      window.SpeechRecognition = class {
        constructor() {
          window.__voice = this;
        }
        start() {
          this.onstart?.();
        }
        stop() {
          this.onend?.();
        }
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const checks = [],
      errors = [];
    let approvals = 0,
      submissions = 0,
      chatPosts = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      if (r.url().endsWith("/approve")) approvals++;
      if (r.url().endsWith("/execute")) submissions++;
      if (r.url().endsWith("/api/chat")) chatPosts++;
    });
    const input = page.getByLabel("Message AGUS", { exact: true });
    const send = async (text) => {
      await input.fill(text);
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
      );
      if (viewport.width > 700) await input.press("Enter");
      else
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
      const r = await response;
      assert.equal(r.status(), 200);
      const data = await r.json();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".agus-composer")
            ?.getAttribute("aria-busy") === "false",
      );
      return data;
    };
    await page.goto(base);
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    assert.match(await input.getAttribute("placeholder"), /Ask agus/);
    await input.fill("Hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.locator(".agus-signin[open]").waitFor();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    await input.fill("first line");
    await input.press(viewport.width > 700 ? "Shift+Enter" : "Enter");
    assert.equal(await input.inputValue(), "first line\n");
    await input.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      ),
    );
    assert.equal(await input.inputValue(), "first line\n");
    const greeting = await send(`Hey there from ${viewport.width}px`);
    assert.equal(greeting.reply.kind, "general");
    assert.equal(greeting.reply.evidence.toolCalls, 0);
    assert.match(greeting.reply.text, /Hey!/);
    const chatUrl = page.url();
    const education = await send("Explain inflation in simple terms");
    assert.equal(education.reply.kind, "general");
    assert.match(education.reply.text, /purchasing power/);
    checks.push(
      "v1.2 welcome, shared-operator sign-in, desktop/mobile newline and IME, general conversation and education",
    );
    const nav = async () => {
      if (!(await page.locator(".agus-sidebar").isVisible()))
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
      return page.locator(
        viewport.width < 700 ? ".agus-drawer" : ".agus-sidebar",
      );
    };
    await (await nav()).getByRole("button", { name: /^Account:/ }).click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const totals = await send("Show my spending for October 2026");
    assert.equal(totals.reply.kind, "financial");
    assert.match(totals.reply.text, /₦19,751.51/);
    assert.match(totals.reply.text, /₦250,000.00/);
    assert.match(totals.reply.text, /₦230,248.49/);
    const total = page.locator(".agus-assistant-message").last();
    assert.equal(await total.locator(".agus-fallback").count(), 0);
    await total.locator(".agus-sources>summary").click();
    assert.match(await total.innerText(), /Calculation/);
    const matches = await send("Find payments to Ada in October 2026");
    assert.equal(
      matches.reply.kind,
      "clarify",
      "similar names must retain ambiguity",
    );
    assert.match(matches.reply.text, /Ada Obi/);
    assert.match(matches.reply.text, /Ada Okafor/);
    const investigation = await send(
      "Search amina-current in October 2026 for exact reference SYNTHETIC-ada-okafor-oct, then retrieve transaction details and payment evidence. Explain what that evidence establishes.",
    );
    assert.equal(investigation.reply.kind, "financial");
    assert.equal(investigation.reply.evidence.toolCalls, 3);
    assert.equal(investigation.reply.citations.length, 3);
    assert.match(
      investigation.reply.text,
      /does not establish recipient bank credit/,
    );
    assert.equal(approvals + submissions, 0);
    checks.push(
      "account-scoped SQL totals, accepted mocked narration, expandable evidence, search, three-tool historical investigation with evidence limitations",
    );
    await page.reload();
    await page.locator(".agus-assistant-message").last().waitFor();
    assert.equal(await page.locator(".agus-assistant-message").count(), 5);
    assert.match(
      await (
        await nav()
      )
        .getByRole("button", { name: /^Account:/ })
        .getAttribute("aria-label"),
      /No account/,
    );
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    // Lost response after persistence: reconcile saved history without replay.
    await page.route(
      "**/api/conversation",
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 },
    );
    await input.fill("Hey, save this but lose the response");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "could not be confirmed" })
      .waitFor();
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector("#financial-message")?.value === "",
    );
    assert.equal(await page.locator(".agus-assistant-message").count(), 6);
    checks.push(
      "completed transcript survives reload, account authority clears, lost-response recovery restores saved turn",
    );
    await send(
      "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
    );
    await input.fill("Draft to resume after payment");
    await page
      .getByRole("button", { name: /Open payment draft/ })
      .last()
      .click();
    await page.waitForURL(
      (url) => url.pathname === "/" && url.searchParams.has("fromChat"),
    );
    await page.locator(".proposal-summary").last().waitFor();
    const paymentInput = page.getByLabel("Message Agus", { exact: true });
    await paymentInput.fill("Typed text\n");
    const beforeVoice = chatPosts;
    await page
      .getByRole("button", { name: "Start voice input", exact: true })
      .click();
    await page.evaluate(() => {
      window.__lateVoice = window.__voice.onresult;
      window.__voice.onresult({
        results: [{ isFinal: true, 0: { transcript: "transcribed text" } }],
      });
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".composer textarea")?.value ===
        "Typed text\ntranscribed text",
    );
    assert.equal(
      await paymentInput.inputValue(),
      "Typed text\ntranscribed text",
    );
    await page
      .getByRole("button", { name: "Stop voice input", exact: true })
      .click();
    await page.evaluate(() =>
      window.__lateVoice({
        results: [{ isFinal: true, 0: { transcript: "late text" } }],
      }),
    );
    assert.equal(
      await paymentInput.inputValue(),
      "Typed text\ntranscribed text",
    );
    assert.equal(chatPosts, beforeVoice, "dictation never sends");
    checks.push(
      "merged browser dictation preserves multiline text, fills without sending, ignores late results after stop",
    );
    await page.locator(".proposal-summary>summary").last().click();
    const proposal = page
      .getByRole("region", { name: "Payment proposal", exact: true })
      .last();
    await proposal
      .getByLabel("Fictional recipient 1")
      .selectOption("0000000001");
    await proposal.getByLabel("Amount (NGN)", { exact: true }).fill("500");
    await proposal
      .getByRole("button", { name: "Add recipient", exact: true })
      .click();
    await proposal
      .getByLabel("Fictional recipient 2")
      .selectOption("0000000002");
    await proposal
      .getByLabel("Amount (NGN)", { exact: true })
      .nth(1)
      .fill("700");
    await proposal
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await proposal.waitFor({ state: "detached" });
    await page
      .locator(".compact-payment:not(.proposal-summary)>summary")
      .last()
      .click();
    const card = page.locator(".batch-card").last();
    await card
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    await card.getByRole("checkbox").check();
    await card.getByLabel("Password to approve reviewed batch").fill(password);
    await card
      .getByRole("button", { name: "Approve reviewed batch", exact: true })
      .click();
    const submit = card.getByRole("button", {
      name: "Submit simulated transfers",
      exact: true,
    });
    await submit.waitFor();
    assert.equal(approvals, 1);
    assert.equal(submissions, 0);
    assert.equal(
      await page.locator(".composer").count(),
      0,
      "review hides the composer",
    );
    await submit.click();
    await card
      .getByRole("button", { name: "Check provider", exact: true })
      .click();
    await card.locator(".payment-row .badge.successful").waitFor();
    await card.locator(".payment-row .badge.processing").waitFor();
    assert.equal(submissions, 1);
    const paymentUrl = page.url();
    const returnLink = page.locator(".return-chat");
    assert.equal(
      new URL(await returnLink.getAttribute("href"), base).searchParams.get(
        "chat",
      ),
      new URL(chatUrl).searchParams.get("chat"),
    );
    await returnLink.click();
    await page.locator(".agus-assistant-message").first().waitFor();
    assert.equal(await input.inputValue(), "Draft to resume after payment");
    checks.push(
      "client navigation returns to originating chat with its transient unsent draft",
    );
    await page.goto(paymentUrl);
    await page
      .locator(".compact-payment:not(.proposal-summary)>summary")
      .last()
      .waitFor();
    await page.reload();
    await page
      .locator(".compact-payment:not(.proposal-summary)>summary")
      .last()
      .click();
    await page
      .locator(".batch-card")
      .last()
      .locator(".payment-row .badge.processing")
      .waitFor();
    await page
      .locator(".batch-card")
      .last()
      .locator(".payment-row .badge.successful")
      .waitFor();
    checks.push(
      "editable draft, beneficiary verification, password approval, separate simulated submission, individual successful/pending outcomes survive reload",
    );
    await page.locator(".return-chat").click();
    await page.locator(".agus-assistant-message").first().waitFor();
    assert.equal(await page.locator(".agus-assistant-message").count(), 7);
    assert.equal(
      await input.inputValue(),
      "",
      "unsent drafts are intentionally transient across full reloads",
    );
    const geometry = await input.boundingBox();
    assert.ok(
      geometry.y >= 0 && geometry.y + geometry.height <= viewport.height,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    checks.push(
      "completed chat history restored after payment reload, composer visible, no horizontal overflow or page errors",
    );
    results.push({
      viewport,
      passed: true,
      checks,
      approvals,
      submissions,
      errors,
    });
    console.log(
      `PASS ${viewport.width}px: ${checks.length} integration groups`,
    );
    await context.close();
  }
  await mkdir(dirname(report), { recursive: true });
  await writeFile(
    report,
    JSON.stringify(
      {
        model: "mocked routing/narration",
        data: "fictional",
        paymentMode: "fixture",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser?.close();
  const stopped = new Promise((r) => child.once("exit", r));
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
