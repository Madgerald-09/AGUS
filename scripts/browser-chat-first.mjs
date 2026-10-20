/* global document: readonly, innerWidth: readonly, innerHeight: readonly, getComputedStyle: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "financial-chat-browser-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const base = "http://localhost:3102";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3102",
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
  const screenshots =
    process.env.CHAT_SCREENSHOT_DIR ??
    join(process.cwd(), "docs/ux-refinement/after");
  await mkdir(screenshots, { recursive: true });
  const results = [];
  const errors = [];
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  assert.equal(await page.title(), "agus. · Your money, and what's next.");
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Operator password", { exact: true })
      .getAttribute("type"),
    "text",
  );
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("heading", { name: /What can I help you/ }).waitFor();
  const widths = [
    { width: 1440, height: 1000, name: "desktop" },
    { width: 820, height: 900, name: "narrow-desktop" },
    { width: 390, height: 844, name: "mobile-390" },
    { width: 320, height: 740, name: "mobile-320" },
  ];
  async function layoutCheck(name) {
    const identity = await page.evaluate(() => {
      const violations = [];
      for (const el of document.querySelectorAll("body *")) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        for (const key of [
          "color",
          "backgroundColor",
          "borderTopColor",
          "borderRightColor",
          "borderBottomColor",
          "borderLeftColor",
          "outlineColor",
        ]) {
          const channels = style[key].match(/[\d.]+/g)?.map(Number);
          if (
            channels?.length >= 3 &&
            (channels[0] !== channels[1] || channels[1] !== channels[2])
          )
            violations.push(
              `${el.tagName}.${el.className}: ${key}=${style[key]}`,
            );
        }
        if (style.backgroundImage.includes("gradient"))
          violations.push("Unexpected gradient");
      }
      return {
        background: getComputedStyle(document.body).backgroundColor,
        sendButton: getComputedStyle(document.querySelector(".send-button"))
          .backgroundColor,
        violations,
      };
    });
    assert.equal(
      identity.background,
      "rgb(0, 0, 0)",
      `${name}: pitch-black page`,
    );
    assert.equal(
      identity.sendButton,
      "rgb(255, 255, 255)",
      `${name}: prominent white primary control`,
    );
    assert.deepEqual(
      identity.violations,
      [],
      `${name}: strictly grayscale rendered identity`,
    );
    const geometry = await page.evaluate(() => {
      const composer = document
        .querySelector(".composer")
        .getBoundingClientRect();
      const signout = document
        .querySelector(".sign-out")
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        composer: {
          left: composer.left,
          right: composer.right,
          top: composer.top,
          bottom: composer.bottom,
        },
        signout: {
          left: signout.left,
          right: signout.right,
          top: signout.top,
          bottom: signout.bottom,
        },
        width: innerWidth,
        height: innerHeight,
      };
    });
    assert.equal(geometry.overflow, false, `${name}: no document overflow`);
    for (const key of ["composer", "signout"]) {
      const box = geometry[key];
      assert.ok(
        box.left >= 0 &&
          box.right <= geometry.width + 1 &&
          box.top >= 0 &&
          box.bottom <= geometry.height,
        `${name}: ${key} remains visible ${JSON.stringify(geometry)}`,
      );
    }
    const conversationOverflow = await page
      .locator(".conversation")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(
      conversationOverflow,
      false,
      `${name}: no conversation overflow`,
    );
  }
  for (const viewport of widths) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await layoutCheck(`${viewport.name}-welcome`);
    await page.screenshot({
      path: join(screenshots, `${viewport.name}-welcome.png`),
    });
  }
  let approvalCalls = 0;
  let executeCalls = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/approve")) approvalCalls++;
    if (req.url().endsWith("/execute")) executeCalls++;
  });
  const send = async (text) => {
    await page.getByLabel("Message Agus").fill(text);
    const response = page.waitForResponse(
      (r) => r.url() === `${base}/api/chat` && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    assert.equal((await response).status(), 200);
  };
  for (const viewport of widths) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await send("Pay my bills");
    const proposal = page.getByRole("region", {
      name: "Payment proposal",
      exact: true,
    });
    await page.locator(".proposal-summary > summary").last().click();
    await proposal.waitFor();
    assert.equal(
      await proposal
        .getByLabel("Recipient label", { exact: true })
        .inputValue(),
      "",
    );
    assert.equal(
      await proposal.getByLabel("Account number", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await proposal.getByLabel("Amount (NGN)", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await proposal.getByLabel("Bank", { exact: true }).inputValue(),
      "",
    );
    await layoutCheck(`${viewport.name}-missing`);
    await proposal.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.screenshot({
      path: join(screenshots, `${viewport.name}-missing.png`),
    });
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
    const savedEdits = page.waitForResponse(
      (r) =>
        r.url().includes("/api/proposals/") &&
        r.request().postDataJSON()?.proposals[1]?.amountNaira === "700",
    );
    await proposal.getByLabel("Description", { exact: true }).nth(1).click();
    assert.equal((await savedEdits).status(), 200);
    await page.reload();
    await page.locator(".proposal-summary > summary").last().click();
    await proposal.waitFor();
    assert.equal(
      await proposal
        .getByLabel("Amount (NGN)", { exact: true })
        .nth(1)
        .inputValue(),
      "700",
      "proposal survives reload",
    );
    assert.equal(
      await proposal
        .getByLabel("Account number", { exact: true })
        .nth(0)
        .inputValue(),
      "0000000001",
    );
    await layoutCheck(`${viewport.name}-proposal`);
    await proposal.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.screenshot({
      path: join(screenshots, `${viewport.name}-proposal.png`),
    });
    await proposal
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await proposal.waitFor({ state: "detached" });
    await page
      .locator(".compact-payment:not(.proposal-summary) > summary")
      .last()
      .click();
    const card = page.locator(".batch-card").last();
    await card
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    await card.getByRole("checkbox").waitFor();
    assert.equal(
      approvalCalls,
      results.length,
      "chat and verification cannot approve",
    );
    assert.equal(
      executeCalls,
      results.length,
      "chat and verification cannot submit",
    );
    await card.getByRole("checkbox").check();
    await card.getByLabel("Password to approve reviewed batch").fill(password);
    await card
      .getByRole("button", { name: "Approve reviewed batch", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .waitFor();
    assert.equal(executeCalls, results.length, "approval alone cannot submit");
    await layoutCheck(`${viewport.name}-approval`);
    await card.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.screenshot({
      path: join(screenshots, `${viewport.name}-review.png`),
    });
    await card
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Check provider", exact: true })
      .waitFor();
    await card
      .getByRole("button", { name: "Check provider", exact: true })
      .click();
    await card.locator(".payment-row .badge.successful").waitFor();
    await card.locator(".payment-row .badge.processing").waitFor();
    await send("What payments are still pending?");
    await page
      .locator(".message.assistant")
      .last()
      .getByText(/Some outcomes are unresolved/)
      .waitFor();
    await layoutCheck(`${viewport.name}-outcomes`);
    const snapshot = await (
      await context.request.get(`${base}/api/state`)
    ).json();
    const batch = snapshot.batches[0];
    assert.deepEqual(
      batch.payments.map((p) => p.status),
      ["successful", "processing"],
    );
    assert.ok(batch.approval.consumedAt);
    const linked = snapshot.messages.find((m) => m.batchId === batch.id);
    assert.equal(linked.sourceRequest, "Pay my bills");
    await page.reload();
    await page.locator(".unfinished").waitFor();
    await layoutCheck(`${viewport.name}-restored`);
    const followUp = page.locator(".message.assistant").last();
    await followUp.getByText(/Some outcomes are unresolved/).waitFor();
    await followUp.evaluate((el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.screenshot({
      path: join(screenshots, `${viewport.name}-follow-up.png`),
    });
    // Secondary views must retain access to conversation and fit small screens.
    for (const tab of ["Payment jobs", "Activity", "Insights"]) {
      if (viewport.width < 700)
        await page.getByRole("button", { name: "Toggle navigation" }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name: tab, exact: true })
        .click();
      await page
        .getByRole("button", { name: "Back to conversation" })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${viewport.name}: ${tab} fits`,
      );
      if (tab === "Activity") {
        const rows = await page.locator(".table-wrap tbody tr").count();
        await page.getByText(`${rows} records`, { exact: true }).waitFor();
        assert.ok(
          (await page
            .getByRole("cell", { name: "Simulation", exact: true })
            .count()) > 0,
        );
      }
      await page.screenshot({
        path: join(
          screenshots,
          `${viewport.name}-${tab.replaceAll(" ", "-").toLowerCase()}.png`,
        ),
      });
      await page.getByRole("button", { name: "Back to conversation" }).click();
    }
    results.push({
      viewport: viewport.name,
      width: viewport.width,
      result: "PASS",
      journey:
        "request → missing fields → persisted edits/reload → linked draft → verification → password approval → explicit simulated submission → successful/processing outcomes → persisted unresolved follow-up",
      layout:
        "No document/conversation overflow; composer and Sign out visible",
    });
    console.log(
      `PASS: ${viewport.name} ${viewport.width}px full fixture journey, reload persistence, no overflow, persistent composer and Sign out.`,
    );
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Insights", exact: true })
    .click();
  await page.getByText("Demonstration ledger", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await page.getByRole("button", { name: "Attach image", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText(/server-side AI configuration/)
    .waitFor();
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in securely" }).waitFor();
  assert.deepEqual(errors, [], "no browser runtime errors");
  await writeFile(
    join(screenshots, "browser-results.json"),
    JSON.stringify(
      {
        mode: "fixture",
        genuineModelCalls: 0,
        visualIdentity:
          "Strict monochrome: pitch-black background, white primary controls, grayscale surfaces/text/borders; status icons and explicit text",

        results,
        browserErrors: errors,
        additional:
          "320px secondary navigation, truthful attachment unavailability and Sign out",
      },
      null,
      2,
    ) + "\n",
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
