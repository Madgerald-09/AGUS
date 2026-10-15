/* global document: readonly, innerHeight: readonly, window: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const screenshots =
  process.env.UX_SCREENSHOT_DIR ??
  join(process.cwd(), "docs/ux-refinement/after");
await mkdir(screenshots, { recursive: true });
const base = "http://localhost:3103";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROMIUM_PATH ??
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
});
const results = [];
const widths = [
  { width: 1440, height: 1000, name: "desktop" },
  { width: 820, height: 900, name: "narrow-desktop" },
  { width: 390, height: 844, name: "mobile-390" },
  { width: 320, height: 740, name: "mobile-320" },
];
try {
  for (const viewport of widths.filter(
    (viewport) =>
      !process.env.UX_VIEWPORT || viewport.name === process.env.UX_VIEWPORT,
  )) {
    const dir = await mkdtemp(join(tmpdir(), "financial-chat-ux-"));
    const password = randomBytes(24).toString("hex");
    const salt = randomBytes(16).toString("hex");
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        "3103",
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
          OPERATOR_ID: "ux-browser-operator",
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
          if (child.exitCode !== null) throw new Error(output);
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
        viewport: { width: viewport.width, height: viewport.height },
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
      await page.clock.install();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const post = async (path, data, expectedStatus = 200) => {
        const response = await context.request.post(`${base}/api/${path}`, {
          data,
          headers: { Origin: base },
        });
        assert.equal(
          response.status(),
          expectedStatus,
          `${path}: ${await response.text()}`,
        );
        return response.json();
      };
      const snapshot = async () =>
        (await context.request.get(`${base}/api/state`)).json();
      const waitIdle = () =>
        page.waitForFunction(
          () =>
            document.querySelector(".composer")?.getAttribute("aria-busy") ===
              "false" && !document.querySelector(".request-progress"),
        );
      const screenshot = (name) =>
        page.screenshot({
          path: join(screenshots, `${viewport.name}-ux-${name}.png`),
        });
      async function fit(name, field = null) {
        const geometry = await page.evaluate(() => {
          const composer = document
            .querySelector(".composer")
            .getBoundingClientRect();
          const visual = window.visualViewport;
          return {
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            contentOverflow:
              document.querySelector(".conversation").scrollWidth >
              document.querySelector(".conversation").clientWidth + 1,
            top: composer.top,
            bottom: composer.bottom,
            height: visual?.height ?? innerHeight,
            offset: visual?.offsetTop ?? 0,
          };
        });
        assert.equal(geometry.overflow, false, `${name}: no document overflow`);
        assert.equal(
          geometry.contentOverflow,
          false,
          `${name}: no chat overflow`,
        );
        assert.ok(
          geometry.top >= geometry.offset &&
            geometry.bottom <= geometry.offset + geometry.height + 1,
          `${name}: composer fits visual viewport: ${JSON.stringify(geometry)}`,
        );
        if (field) {
          try {
            await page.waitForFunction(
              () => {
                const field = document.activeElement.getBoundingClientRect();
                const area = document
                  .querySelector(".conversation")
                  .getBoundingClientRect();
                const focused = document.activeElement;
                const hit = document.elementFromPoint(
                  field.left + field.width / 2,
                  field.top + field.height / 2,
                );
                return (
                  field.top >= area.top - 1 &&
                  field.bottom <= area.bottom + 1 &&
                  (hit === focused || focused.contains(hit))
                );
              },
              undefined,
              { timeout: 3000 },
            );
          } catch (error) {
            await page.screenshot({
              path: `/tmp/financial-ux-focused-${viewport.width}.png`,
            });
            console.error(
              "Focused field geometry",
              await page.evaluate(() => {
                const focused = document.activeElement;
                const field = focused.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  field.left + field.width / 2,
                  field.top + field.height / 2,
                );
                return {
                  tag: focused.tagName,
                  field: field.toJSON(),
                  conversation: document
                    .querySelector(".conversation")
                    .getBoundingClientRect()
                    .toJSON(),
                  hit: hit?.tagName,
                  hitClass: hit?.className,
                };
              }),
            );
            throw error;
          }
        }
      }
      // Hold a real request before forwarding it. No successful response is mocked.
      async function hold(path) {
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        let intercepted;
        const seen = new Promise((resolve) => (intercepted = resolve));
        const matcher = `${base}/api/${path}`;
        let finish;
        const done = new Promise((resolve) => (finish = resolve));
        const handler = async (route) => {
          intercepted();
          await gate;
          try {
            await route.continue();
          } finally {
            finish();
          }
        };
        await page.route(matcher, handler);
        return {
          seen,
          release: async () => {
            release();
            await done;
            await page.unroute(matcher, handler);
          },
        };
      }
      async function send(text) {
        await page.getByLabel("Message the financial agent").fill(text);
        const response = page.waitForResponse(
          (r) => r.url() === `${base}/api/chat`,
        );
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        await waitIdle();
      }
      await page.goto(base);
      await page
        .getByLabel("Operator password", { exact: true })
        .fill(password);
      await page.getByRole("button", { name: "Sign in securely" }).click();
      const composer = page.getByLabel("Message the financial agent");
      await composer.waitFor();
      await page
        .getByRole("heading", { name: /What can I help you/ })
        .waitFor();
      await fit("welcome");
      const welcome = await page.evaluate(() => {
        const composer = document
          .querySelector(".composer")
          .getBoundingClientRect();
        const suggestions = document
          .querySelector(".suggestions")
          .getBoundingClientRect();
        return {
          composerBottom: composer.bottom,
          suggestionsTop: suggestions.top,
          suggestionsHeight: suggestions.height,
          headerHeight: document
            .querySelector(".topbar")
            .getBoundingClientRect().height,
          disclosureHeight: document
            .querySelector(".context-bar")
            .getBoundingClientRect().height,
          height: innerHeight,
        };
      });
      assert.ok(
        welcome.suggestionsTop >= welcome.composerBottom,
        "Welcome suggestions are secondary to composer",
      );
      if (viewport.width < 700) {
        assert.ok(
          welcome.headerHeight <= 52 && welcome.disclosureHeight <= 40,
          "Compact mobile header and visible simulation line",
        );
        assert.ok(
          welcome.composerBottom <= welcome.height * 0.8,
          "Welcome composer is within easy view",
        );
        assert.ok(
          welcome.suggestionsHeight <= 90,
          "Suggestions do not dominate mobile welcome",
        );
      }
      await screenshot("welcome");
      await page.locator(".simulation-disclosure summary").click();
      await page
        .getByText(/Fictional recipients and simulated outcomes/)
        .waitFor();
      await page.locator(".simulation-disclosure summary").click();
      if (viewport.width < 700)
        await page.getByRole("button", { name: "Toggle navigation" }).click();
      await page
        .getByRole("button", { name: "Emergency stop", exact: true })
        .click();
      await page.getByText(/Emergency stop is active/).waitFor();
      await waitIdle();
      assert.equal(
        (await snapshot()).emergencyDisabled,
        true,
        "The relocated emergency stop still changes authoritative state",
      );
      await page
        .getByRole("button", { name: "Enable transfers", exact: true })
        .click();
      await waitIdle();
      assert.equal((await snapshot()).emergencyDisabled, false);
      if (viewport.width < 700)
        await page.getByRole("button", { name: "Toggle navigation" }).click();
      let chatCalls = 0;
      page.on("request", (request) => {
        if (request.url() === `${base}/api/chat`) chatCalls++;
      });
      await composer.fill("A draft with a line");
      await composer.press(viewport.width < 700 ? "Enter" : "Shift+Enter");
      assert.equal(await composer.inputValue(), "A draft with a line\n");
      await composer.dispatchEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      });
      assert.equal(
        chatCalls,
        0,
        "Newlines and IME composition cannot accidentally send",
      );
      if (viewport.width < 700) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height - 300,
        });
        await page.clock.runFor(64);
        await fit("reduced keyboard viewport");
        assert.equal(
          await composer.evaluate((el) => document.activeElement === el),
          true,
        );
        await screenshot("keyboard");
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
      }
      const longDraft = "A long draft kept on this device. ".repeat(40);
      await composer.fill(longDraft);
      assert.equal(await composer.inputValue(), longDraft);
      assert.ok(
        (await composer.boundingBox()).height <= 130,
        "Long drafts use a capped, internally scrollable composer",
      );
      await fit("long draft");
      await composer.fill("Pay my bills");
      const chatGate = await hold("chat");
      const request = page.waitForRequest(`${base}/api/chat`);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await request;
      await chatGate.seen;
      await page
        .locator(".local-message.pending")
        .getByText("Pay my bills", { exact: true })
        .waitFor();
      await page
        .getByRole("status")
        .getByText("Preparing a demo response…", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".welcome,.suggestions").count(),
        0,
        "Welcome disappears immediately on send",
      );
      assert.equal(
        await page.locator(".composer").getAttribute("aria-busy"),
        "true",
      );
      assert.equal(
        await composer.evaluate((el) => document.activeElement === el),
        true,
        "Sending retains composer focus",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .isDisabled(),
        true,
      );
      await composer.fill("Keep this next draft");
      await fit("pending request");
      await screenshot("pending");
      await chatGate.release();
      const proposal = page.getByRole("region", {
        name: "Payment proposal",
        exact: true,
        includeHidden: true,
      });
      await proposal.waitFor({ state: "attached" });
      await waitIdle();
      assert.equal(
        await composer.inputValue(),
        "Keep this next draft",
        "Edits typed while awaiting response survive success",
      );
      assert.equal(
        (await snapshot()).messages.length,
        2,
        "Only real persisted user/assistant messages exist",
      );
      assert.equal(await page.locator(".local-message").count(), 0);
      const position = await page.locator(".message.assistant").boundingBox();
      const conversation = await page.locator(".conversation").boundingBox();
      assert.ok(
        position.y >= conversation.y - 1 && position.y < conversation.y + 55,
        "Response starts at the question, not the bottom of a tall proposal",
      );
      await page.locator(".proposal-summary > summary").last().click();
      await proposal
        .getByLabel("Fictional recipient 1")
        .selectOption("0000000001");
      await proposal.getByLabel("Amount (NGN)", { exact: true }).fill("5000");
      const invalidSave = page.waitForResponse(
        (r) => r.url() === `${base}/api/batches`,
      );
      await proposal
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      assert.equal(
        (await invalidSave).status(),
        400,
        "Actual server limit validation remains enforced",
      );
      await page
        .locator(".chat-error[role=alert]")
        .getByText(/limit exceeded/)
        .waitFor();
      assert.equal(
        await proposal.getByLabel("Amount (NGN)", { exact: true }).inputValue(),
        "5000",
      );
      assert.equal(await composer.inputValue(), "Keep this next draft");
      assert.equal((await snapshot()).batches.length, 0);
      await screenshot("payment-error");
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
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
        .locator(".compact-payment:not(.proposal-summary) > summary")
        .last()
        .click();
      const card = page.locator(".batch-card");
      await card
        .getByRole("button", { name: "Verify beneficiaries", exact: true })
        .click();
      await card.getByRole("checkbox").waitFor();
      await card.locator(".payment-reference summary").first().click();
      assert.ok(
        await card.locator(".payment-reference code").first().isVisible(),
        "Payment references remain available",
      );
      await card.locator(".payment-reference summary").first().click();
      await card.getByRole("checkbox").check();
      await card
        .getByLabel("Password to approve reviewed batch")
        .fill("a-deliberately-wrong-password");
      const badApproval = page.waitForResponse((r) =>
        r.url().endsWith("/approve"),
      );
      await card
        .getByRole("button", { name: "Approve reviewed batch", exact: true })
        .click();
      assert.equal((await badApproval).status(), 401);
      await page.locator(".chat-error[role=alert]").waitFor();
      assert.equal(
        (await snapshot()).batches[0].approval,
        undefined,
        "Wrong password cannot approve",
      );
      assert.equal(await composer.inputValue(), "Keep this next draft");
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
      await waitIdle();
      assert.equal(
        await card
          .getByLabel("Password to approve reviewed batch")
          .inputValue(),
        "",
        "Submitted approval secrets are cleared",
      );
      await card
        .getByLabel("Password to approve reviewed batch")
        .fill(password);
      const goodApproval = page.waitForResponse((r) =>
        r.url().endsWith("/approve"),
      );
      await card
        .getByRole("button", { name: "Approve reviewed batch", exact: true })
        .click();
      const approvalResponse = await goodApproval;
      assert.equal(
        approvalResponse.status(),
        200,
        await approvalResponse.text(),
      );
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .waitFor();
      await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await screenshot("review");
      const batch = (await snapshot()).batches[0];
      const submissionGate = await hold(`batches/${batch.id}/execute`);
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .click();
      await submissionGate.seen;
      await page
        .getByRole("status")
        .getByText("Submitting simulated transfers…", { exact: true })
        .waitFor();
      assert.ok(
        !(await snapshot()).batches[0].approval.consumedAt,
        "Pending UI does not invent submission outcomes",
      );
      await fit("simulated submission progress");
      await screenshot("submission");
      await submissionGate.release();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .waitFor();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .click();
      await card.locator(".payment-row .badge.successful").waitFor();
      await card.locator(".payment-row .badge.processing").waitFor();
      assert.deepEqual(
        (await snapshot()).batches[0].payments.map((p) => p.status),
        ["successful", "processing"],
      );
      // Build a genuinely persisted long conversation without inventing messages.
      for (let i = 0; i < 12; i++)
        await post("chat", { message: "What payments are still pending?" });
      await page.reload();
      await composer.waitFor();
      await send("Pay my bills");
      const draft = page.getByRole("region", {
        name: "Payment proposal",
        exact: true,
        includeHidden: true,
      });
      await page.locator(".proposal-summary > summary").last().click();
      const labelInput = draft.getByLabel("Recipient label", { exact: true });
      await labelInput.fill("Keep this unfinished recipient");
      await draft.getByLabel("Amount (NGN)", { exact: true }).fill("50");
      await draft.getByLabel("Description", { exact: true }).click();
      await composer.fill("Keep this unsent message");
      await page.locator(".conversation").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page
        .getByRole("button", { name: "Latest messages", exact: true })
        .waitFor();
      const beforeScroll = await page
        .locator(".conversation")
        .evaluate((el) => el.scrollTop);
      await post("chat", { message: "What payments are still pending?" });
      const expectedCount = (await snapshot()).messages.length;
      const poll = page.waitForResponse(`${base}/api/state`);
      await page.clock.fastForward(21000);
      await poll;
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".conversation-turn").length === count,
        expectedCount,
      );
      const afterScroll = await page
        .locator(".conversation")
        .evaluate((el) => el.scrollTop);
      assert.ok(
        Math.abs(afterScroll - beforeScroll) < 5,
        "Polling new messages does not pull a reader away from older content",
      );
      assert.equal(
        await labelInput.inputValue(),
        "Keep this unfinished recipient",
        "Polling retains editable proposal input",
      );
      assert.equal(await composer.inputValue(), "Keep this unsent message");
      await fit("long conversation");
      await screenshot("long-conversation");
      await page
        .getByRole("button", { name: "Latest messages", exact: true })
        .click();
      await page.waitForFunction(() => {
        const el = document.querySelector(".conversation");
        return el.scrollHeight - el.scrollTop - el.clientHeight < 5;
      });
      if (viewport.width < 700) {
        await labelInput.focus();
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height - 300,
        });
        await page.clock.runFor(64);
        await fit("proposal field with reduced keyboard viewport", labelInput);
        assert.equal(
          await labelInput.inputValue(),
          "Keep this unfinished recipient",
        );
        await screenshot("proposal-keyboard");
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
      }
      // Transport failure is explicit, with no mocked model response or fake fallback.
      const countBeforeFailure = (await snapshot()).messages.length;
      await page.route(`${base}/api/chat`, (route) => route.abort("failed"), {
        times: 1,
      });
      await composer.fill("Keep this message after a network error");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.locator(".local-message.failed").waitFor();
      await page.locator(".chat-error[role=alert]").waitFor();
      assert.equal(
        await composer.inputValue(),
        "Keep this message after a network error",
      );
      assert.equal(
        (await snapshot()).messages.length,
        countBeforeFailure,
        "No fake reply on failed request",
      );
      await fit("transport error");
      await screenshot("error");
      await page
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
      // A persisted response followed by a failed refresh must also retain input.
      await page.route(`${base}/api/state`, (route) => route.abort("failed"), {
        times: 1,
      });
      await composer.fill("What payments are still pending?");
      const savedResponse = page.waitForResponse(`${base}/api/chat`);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      assert.equal((await savedResponse).status(), 200);
      await page.locator(".local-message.failed").waitFor();
      assert.equal(
        await composer.inputValue(),
        "What payments are still pending?",
        "Refresh failure cannot erase typed input",
      );
      assert.equal(
        (await snapshot()).messages.length,
        countBeforeFailure + 2,
        "The endpoint response really persisted",
      );
      assert.deepEqual(errors, [], "No browser runtime errors");
      results.push({
        viewport: viewport.name,
        width: viewport.width,
        result: "PASS",
        persistedMessages: countBeforeFailure + 2,
        scenarios: [
          "compact welcome and disclosures",
          "secondary navigation retains the authenticated emergency stop",
          "composer-first suggestions",
          "Enter/Shift+Enter and IME",
          "touch/reduced visual viewport and focused proposal inputs",
          "real request gating with contextual progress",
          "edited composer retained during success",
          "real server limit and password errors",
          "explicit approval and simulated submission",
          "actual successful/processing outcomes",
          "long conversation, polling and user-controlled scrolling",
          "transport and post-response refresh errors retain input",
        ],
        nativeKeyboard:
          "Not exercised: headless Chromium uses touch/mobile contexts and focused reduced-viewport checks",
      });
      console.log(
        `PASS: ${viewport.name} ${viewport.width}px P1 welcome, progress, errors, keyboard viewport, long conversation, proposal and authenticated fixture journey.`,
      );
    } catch (error) {
      console.error(output.slice(-4000));
      throw error;
    } finally {
      await context?.close();
      child.kill("SIGTERM");
      await new Promise((resolve) =>
        child.exitCode !== null ? resolve() : child.once("exit", resolve),
      );
      await rm(dir, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(
      screenshots,
      process.env.UX_VIEWPORT
        ? `ux-results-${process.env.UX_VIEWPORT}.json`
        : "ux-results.json",
    ),
    JSON.stringify(
      { mode: "fixture", genuineModelCalls: 0, fakeResponses: 0, results },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
