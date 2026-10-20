/* global document: readonly, window: readonly, getComputedStyle: readonly, KeyboardEvent: readonly, requestAnimationFrame: readonly, Event: readonly */
// Composer-only production verification. No screenshots, tracing or recordings.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:3114";
const dataDir = await mkdtemp(join(tmpdir(), "agus-composer-"));
const reportPath =
  process.env.COMPOSER_REPORT ??
  join(process.cwd(), "docs/visual-v1-2/composer-results.json");
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
    "3114",
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
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const mobile = viewport.width === 390;
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const checks = [],
      errors = [];
    let posts = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/conversation")
      )
        posts++;
    });
    const check = async (name, run) => {
      try {
        const measurements = await run();
        checks.push({
          name,
          passed: true,
          ...(measurements ? { measurements } : {}),
        });
      } catch (error) {
        checks.push({ name, passed: false, error: error.message });
      }
    };
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    await page.goto(`${base}/`);
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    const input = page.getByLabel("Message AGUS", { exact: true });
    const sendButton = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    const measure = () =>
      page.evaluate(() => {
        const input = document.querySelector("#financial-message");
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            height: r.height,
            left: r.left,
            right: r.right,
          };
        };
        return {
          form: rect(".agus-composer"),
          dock: rect(".agus-composer-area"),
          footer: rect(".agus-demo-strip"),
          workspace: rect(".agus-workspace"),
          input: rect("#financial-message"),
          inputScrollHeight: input.scrollHeight,
          inputScrollTop: input.scrollTop,
          start: input.selectionStart,
          end: input.selectionEnd,
          focus: document.activeElement === input,
          scrollTop: document.querySelector(".agus-scroll").scrollTop,
          maxHeight: getComputedStyle(input).maxHeight,
        };
      });
    const keyboardProbe = () =>
      page.evaluate(() => {
        const original = window.visualViewport;
        const heightDescriptor = Object.getOwnPropertyDescriptor(
          original,
          "height",
        );
        const offsetDescriptor = Object.getOwnPropertyDescriptor(
          original,
          "offsetTop",
        );
        Object.defineProperties(original, {
          height: { configurable: true, get: () => 300 },
          offsetTop: { configurable: true, get: () => 48 },
        });
        window.__restoreComposerViewport = () => {
          if (heightDescriptor)
            Object.defineProperty(original, "height", heightDescriptor);
          else delete original.height;
          if (offsetDescriptor)
            Object.defineProperty(original, "offsetTop", offsetDescriptor);
          else delete original.offsetTop;
          original.dispatchEvent(new Event("resize"));
        };
        original.dispatchEvent(new Event("resize"));
      });
    const editAt = async (position, text) => {
      await input.focus();
      await input.evaluate(
        (el, position) => el.setSelectionRange(position, position),
        position,
      );
      await page.keyboard.insertText(text);
      await settle();
    };
    const nav = async () => {
      if (mobile) {
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        return page.locator(".agus-drawer");
      }
      if (!(await page.locator(".agus-sidebar").isVisible()))
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
      return page.locator(".agus-sidebar");
    };
    const submit = async (text) => {
      const count = await page.locator(".agus-assistant-message").count();
      await input.fill(text);
      await sendButton.click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".agus-assistant-message").length > count &&
          document.querySelector(".agus-composer").getAttribute("aria-busy") ===
            "false",
        count,
      );
    };
    await check(
      "new-chat composer is centered and grows without losing the insertion point",
      async () => {
        const initial = await measure();
        assert.ok(
          initial.form.top > viewport.height * 0.15 &&
            initial.form.bottom < viewport.height - 100,
        );
        assert.ok(
          Math.abs(
            (initial.form.left + initial.form.right) / 2 - viewport.width / 2,
          ) < 2,
        );
        await input.fill("one\ntwo\nthree\nfour");
        await editAt(4, "edited ");
        const grown = await measure();
        assert.ok(grown.form.height > initial.form.height);
        assert.equal(grown.start, 11);
        assert.ok(grown.focus);
        return {
          initialHeight: initial.form.height,
          expandedHeight: grown.form.height,
        };
      },
    );
    if (mobile)
      await check(
        "new-chat composer remains usable in a keyboard-sized visual viewport",
        async () => {
          await input.fill("A multiline guest draft\n".repeat(20));
          await input.focus();
          const before = await input.inputValue();
          await keyboardProbe();
          await settle();
          const compact = await measure();
          try {
            assert.equal(compact.workspace.height, 300);
            assert.ok(
              compact.form.top >= 48 && compact.form.bottom <= 348,
              JSON.stringify(compact),
            );
            assert.ok(compact.input.height <= 80);
            assert.ok(compact.focus);
            assert.equal(await input.inputValue(), before);
          } finally {
            await page.evaluate(() => window.__restoreComposerViewport());
            await settle();
          }
          return { form: compact.form, inputHeight: compact.input.height };
        },
      );
    await check(
      "sign-in retains the guest draft without automatic submission",
      async () => {
        await input.fill("Guest draft retained");
        await input.evaluate((el) => el.setSelectionRange(6, 6));
        if (mobile) await sendButton.click();
        else await input.press("Enter");
        await page.locator(".agus-signin[open]").waitFor();
        await page
          .getByLabel("Operator password", { exact: true })
          .fill(password);
        await page
          .locator(".agus-signin")
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page.locator(".agus-signin").waitFor({ state: "hidden" });
        await page
          .locator(".agus-drawer .agus-account-trigger")
          .waitFor({ state: "attached" });
        assert.equal(await input.inputValue(), "Guest draft retained");
        assert.equal((await measure()).start, 6);
        assert.equal(posts, 0);
      },
    );
    await check(
      mobile
        ? "mobile Return inserts a line without sending"
        : "desktop Shift+Enter inserts a line and Enter sends once",
      async () => {
        await input.fill(`Hello from ${viewport.width}px`);
        const priorPosts = posts;
        await input.press(mobile ? "Enter" : "Shift+Enter");
        assert.equal(
          await input.inputValue(),
          `Hello from ${viewport.width}px\n`,
        );
        assert.equal(posts, priorPosts);
        if (mobile) await sendButton.click();
        else await input.press("Enter");
        await page.locator(".agus-assistant-message").first().waitFor();
        await page.waitForFunction(
          () =>
            document
              .querySelector(".agus-composer")
              .getAttribute("aria-busy") === "false",
        );
        assert.equal(posts, priorPosts + 1);
      },
    );
    await check(
      "conversation composer stays at the bottom and grows upward into an internally scrolling input",
      async () => {
        await input.fill("short draft");
        await settle();
        const short = await measure();
        await input.fill(
          Array.from({ length: 30 }, (_, i) => `draft line ${i}`).join("\n"),
        );
        await settle();
        const long = await measure();
        assert.ok(Math.abs(short.form.bottom - long.form.bottom) < 2);
        assert.ok(long.form.top < short.form.top);
        assert.ok(long.input.height <= 160 && long.input.height >= 150);
        assert.ok(long.inputScrollHeight > long.input.height);
        assert.ok(Math.abs(long.dock.bottom - long.footer.top) < 2);
        assert.ok(Math.abs(long.footer.bottom - long.workspace.bottom) < 2);
        await editAt(10, "X");
        assert.equal((await measure()).start, 11);
        assert.equal((await measure()).focus, true);
        await input.press("ControlOrMeta+End");
        assert.ok((await measure()).inputScrollTop > 0);
        return {
          shortTop: short.form.top,
          longTop: long.form.top,
          bottom: long.form.bottom,
          inputHeight: long.input.height,
        };
      },
    );
    if (mobile) {
      // Exercise the real selected-account scope row as well as the composer.
      const sidebar = await nav();
      await sidebar.getByRole("button", { name: /^Account:/ }).click();
      await page
        .locator("#agus-account option")
        .nth(1)
        .waitFor({ state: "attached" });
      await page.locator("#agus-account").selectOption({ index: 1 });
      await page
        .getByRole("button", { name: "Close account", exact: true })
        .click();
      await settle();
      await check(
        "keyboard-style visual viewport shrink and pan keep the input and Send visible",
        async () => {
          await input.focus();
          const before = await measure(),
            value = await input.inputValue();
          await keyboardProbe();
          await settle();
          const compact = await measure();
          try {
            assert.equal(
              compact.workspace.height,
              300,
              "Keyboard probe must change the application viewport",
            );
            assert.ok(
              compact.form.top >= 48 && compact.form.bottom <= 348,
              JSON.stringify(compact),
            );
            assert.ok(compact.input.height <= 80, JSON.stringify(compact));
            assert.equal(await input.inputValue(), value);
            assert.equal(compact.start, before.start);
            assert.ok(compact.focus);
          } finally {
            await page.evaluate(() => window.__restoreComposerViewport());
            await settle();
          }
          return {
            compactForm: compact.form,
            inputHeight: compact.input.height,
          };
        },
      );
      await check(
        "layout viewport resizing preserves draft, caret and focus, then restores natural expansion",
        async () => {
          await input.fill("initial");
          await input.focus();
          await page.setViewportSize({ width: 390, height: 350 });
          await input.fill(
            Array.from({ length: 25 }, (_, i) => `keyboard line ${i}`).join(
              "\n",
            ),
          );
          await editAt(20, "insert");
          const compact = await measure(),
            value = await input.inputValue();
          await page.setViewportSize(viewport);
          await settle();
          const restored = await measure();
          assert.equal(await input.inputValue(), value);
          assert.equal(restored.start, compact.start);
          assert.ok(restored.focus);
          assert.ok(restored.input.height >= 150, JSON.stringify(restored));
          return {
            compactHeight: compact.input.height,
            restoredHeight: restored.input.height,
          };
        },
      );
    }
    // Long submitted turns give the actual thread enough content for a reading-position test.
    await submit(
      "Hey, here are some notes\n" + "A fictional planning note.\n".repeat(40),
    );
    await submit(
      "Hey, some more notes\n" +
        "Another fictional planning note.\n".repeat(40),
    );
    await check(
      "a delayed reply does not steal reading scroll or focus",
      async () => {
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        await page.route(
          "**/api/conversation",
          async (route) => {
            await gate;
            await route.continue();
          },
          { times: 1 },
        );
        const count = await page.locator(".agus-assistant-message").count();
        await input.fill("Hey, keep this response brief");
        await sendButton.click();
        await page.locator(".agus-thinking").waitFor();
        await page.locator(".agus-scroll").evaluate((el) => {
          el.scrollTop = 120;
        });
        const disclosure = page.locator(".agus-demo-strip summary");
        await disclosure.focus();
        await settle();
        const before = await measure();
        release();
        await page.waitForFunction(
          (count) =>
            document.querySelectorAll(".agus-assistant-message").length >
              count &&
            document
              .querySelector(".agus-composer")
              .getAttribute("aria-busy") === "false",
          count,
        );
        const after = await measure();
        assert.ok(
          Math.abs(after.scrollTop - before.scrollTop) < 2,
          `${before.scrollTop} -> ${after.scrollTop}`,
        );
        assert.ok(
          await disclosure.evaluate((el) => document.activeElement === el),
        );
        await page
          .getByRole("button", { name: "Latest response", exact: true })
          .waitFor();
      },
    );
    await check(
      "chat navigation retains the draft and its insertion point without forcing input focus",
      async () => {
        const url = page.url();
        await input.fill("Per-chat editable draft");
        await input.focus();
        await input.evaluate((el) => {
          el.setSelectionRange(4, 4);
          el.dispatchEvent(new Event("select", { bubbles: true }));
        });
        const sidebar = await nav();
        await sidebar
          .getByRole("button", { name: "New chat", exact: true })
          .click();
        await input.fill("Another unsent draft");
        await page.locator(".agus-navigation-toggle").focus();
        await page.goBack();
        await page.waitForURL(url);
        await page.locator(".agus-assistant-message").first().waitFor();
        await settle();
        assert.equal(await input.inputValue(), "Per-chat editable draft");
        assert.equal((await measure()).start, 4);
        assert.equal((await measure()).focus, false);
      },
    );
    await check(
      "native Chromium composition and composing Enter never send",
      async () => {
        await input.fill("");
        await input.focus();
        const priorPosts = posts;
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.imeSetComposition", {
          text: "日本",
          selectionStart: 2,
          selectionEnd: 2,
        });
        await input.evaluate((el) =>
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              keyCode: 229,
              isComposing: true,
              bubbles: true,
            }),
          ),
        );
        assert.equal(posts, priorPosts);
        await cdp.send("Input.insertText", { text: "日本" });
        await cdp.detach();
      },
    );
    if (!mobile)
      await check(
        "IME keyCode 229 cannot submit after a composition boundary",
        async () => {
          await input.fill("Unsent composition text");
          const priorPosts = posts;
          await input.evaluate((el) =>
            el.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                keyCode: 229,
                isComposing: false,
                bubbles: true,
              }),
            ),
          );
          await settle();
          assert.equal(posts, priorPosts);
          assert.equal(await input.inputValue(), "Unsent composition text");
        },
      );
    checks.push({
      name: "no browser runtime errors",
      passed: errors.length === 0,
      errors,
    });
    results.push({ viewport, checks });
    await context.close();
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        inference: "mocked model; real application sessions and SQL",
        mediaCaptured: false,
        mobileCoverage:
          "Chromium touch emulation; reduced layout viewport plus synthetic visual viewport shrink/pan. Physical iOS/Android software keyboards are not verified.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  const failures = results.flatMap((result) =>
    result.checks
      .filter((check) => !check.passed)
      .map((check) => ({ viewport: result.viewport, ...check })),
  );
  console.log(JSON.stringify({ failures, report: reportPath }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await rm(dataDir, { recursive: true, force: true });
}
