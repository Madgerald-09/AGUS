/* global window: readonly, PerformanceObserver: readonly, getComputedStyle: readonly, MutationObserver: readonly, performance: readonly, localStorage: readonly, sessionStorage: readonly, KeyboardEvent: readonly */
/* global document: readonly, innerWidth: readonly, innerHeight: readonly */
import { URL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
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
  join(process.cwd(), "docs/approved-p0/after");
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
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const matrix = [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 820, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
    { width: 740, height: 390 },
  ];
  for (const [index, viewport] of matrix.entries()) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
      reducedMotion: "no-preference",
    });
    if (viewport.width === 390)
      await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    const errors = [],
      checks = [];
    let approvals = 0,
      executions = 0,
      posts = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/approve")) approvals++;
      if (r.url().endsWith("/execute")) executions++;
      if (r.url().endsWith("/api/conversation") && r.method() === "POST")
        posts++;
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    await page.addInitScript(() => {
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
      window.__metrics = { lcp: 0, cls: 0, interactions: [], feedbackMs: null };
      let actionAt = null;
      document.addEventListener("pointerdown", (e) => {
        if (e.target.closest?.(".agus-send")) actionAt = performance.now();
      });
      new MutationObserver(() => {
        if (
          actionAt !== null &&
          document.querySelector(".agus-thinking") &&
          window.__metrics.feedbackMs === null
        )
          window.__metrics.feedbackMs = performance.now() - actionAt;
      }).observe(document, { childList: true, subtree: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__metrics.lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (!e.hadRecentInput) window.__metrics.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.interactionId)
            window.__metrics.interactions.push({
              name: e.name,
              duration: e.duration,
            });
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    });
    const shot = (name) =>
      page.screenshot({
        path: join(
          evidence,
          `${name}-${viewport.width}x${viewport.height}.png`,
        ),
      });
    const input = page.getByLabel("Message AGUS", { exact: true });
    const fit = async (composer = true) => {
      const geometry = await page.evaluate(() => {
        const c = document
          .querySelector(".agus-composer")
          ?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          composerVisible: !c || (c.bottom <= innerHeight + 1 && c.top >= 0),
          bodySize: document.querySelector(".agus-prose")
            ? getComputedStyle(document.querySelector(".agus-prose")).fontSize
            : "16px",
          inputSize: document.querySelector("#financial-message")
            ? getComputedStyle(document.querySelector("#financial-message"))
                .fontSize
            : "16px",
        };
      });
      assert.equal(geometry.overflow, false, JSON.stringify(geometry));
      if (composer)
        assert.equal(geometry.composerVisible, true, JSON.stringify(geometry));
      assert.equal(geometry.inputSize, "16px");
      assert.equal(geometry.bodySize, "16px");
    };
    const nav = async () => {
      if (viewport.width < 1024) {
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        return page.locator(".agus-drawer");
      }
      return page.getByRole("complementary");
    };
    const send = async (text) => {
      const n = await page.locator(".agus-assistant-message").count();
      await input.fill(text);
      if (viewport.width >= 768) await input.press("Enter");
      else
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
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
    await page.locator(".agus-signin-hint").waitFor();
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.id),
      "financial-message",
    );
    await shot("welcome-guest");
    if (viewport.width === 390) {
      const second = await page
        .getByRole("button", { name: "Find a transaction", exact: true })
        .boundingBox();
      assert.ok(second.y + second.height <= viewport.height);
    }
    await page
      .locator(".agus-signin-hint")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    if (index === 0 || viewport.width === 390) {
      await page
        .getByLabel("Operator password", { exact: true })
        .fill("incorrect-demo-password");
      await page
        .getByRole("button", { name: "Sign in securely", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Sign-in failed" })
        .waitFor();
      await shot("signin-error");
    }
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Sign in securely", exact: true })
      .click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    await fit(viewport.height > 520);
    await shot("welcome");
    await input.fill("Preserve this draft");
    await page.getByRole("button", { name: "Spend", exact: true }).click();
    assert.equal(await input.inputValue(), "Preserve this draft");
    await input.fill("line one");
    await input.press(viewport.width < 768 ? "Enter" : "Shift+Enter");
    assert.equal(await input.inputValue(), "line one\n");
    const imePosts = posts;
    await input.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      ),
    );
    assert.equal(posts, imePosts, "IME composition never submits");
    await input.fill("x".repeat(4000));
    await input.press("x");
    assert.equal((await input.inputValue()).length, 4000);
    assert.match(
      await page.locator(".agus-character-count").innerText(),
      /Message limit reached/,
    );
    const general = await send(`Hey there from ${viewport.width}px`);
    assert.match(await general.innerText(), /Hey!/);
    assert.equal(await general.locator(".agus-totals").count(), 0);
    await shot("general");
    const firstUrl = page.url();
    await input.fill("Draft in first chat");
    let sidebar = await nav();
    await shot("history");
    await sidebar
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await send("Explain inflation in simple terms");
    const secondUrl = page.url();
    await input.fill("Draft in second chat");
    sidebar = await nav();
    await sidebar
      .getByRole("button", {
        name: `Hey there from ${viewport.width}px`,
        exact: true,
      })
      .first()
      .click();
    await page.locator(".agus-assistant-message").waitFor();
    assert.equal(await input.inputValue(), "Draft in first chat");
    await page.goBack();
    await page.waitForURL(secondUrl);
    await page.locator(".agus-assistant-message").waitFor();
    assert.equal(await input.inputValue(), "Draft in second chat");
    await page.goForward();
    await page.waitForURL(firstUrl);
    await page.locator(".agus-assistant-message").waitFor();
    assert.equal(await input.inputValue(), "Draft in first chat");
    checks.push(
      "transient per-chat drafts; prompt protection; Back/Forward; touch Return/desktop newline",
    );
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await shot("account");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const total = await send("Show my spending for October 2026");
    assert.match(await total.innerText(), /₦19,751.51/);
    assert.match(await total.innerText(), /₦250,000.00/);
    assert.match(await total.innerText(), /₦230,248.49/);
    assert.equal(
      await total.locator(".agus-fallback").count(),
      0,
      "mock narration accepted",
    );
    assert.match(await total.innerText(), /partial/);
    await fit();
    await shot("spending");
    await total.locator(".agus-sources>summary").click();
    assert.match(await total.innerText(), /Calculation/);
    await shot("spending-expanded");
    const matches = await send("Find payments to Ada in October 2026");
    assert.match(await matches.innerText(), /Ada Obi/);
    assert.match(await matches.innerText(), /Ada Okafor/);
    await shot("matches");
    const beforeChoice = posts;
    await matches.getByRole("button", { name: /^Show Ada Obi/ }).click();
    assert.match(await input.inputValue(), /candidate/);
    assert.equal(posts, beforeChoice);
    await input.fill("");
    sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "Plans · Preview", exact: true })
      .click();
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page
      .getByRole("heading", { name: "Personal Plus", exact: true })
      .waitFor();
    await shot("plans");
    await page
      .getByRole("button", { name: "Close plans", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    checks.push(
      "exact totals; AI stage mocked and accepted; evidence; unique transaction choice; one modal; plans preview",
    );
    // A response lost AFTER persistence must be reconciled, never auto-replayed.
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
    await shot("unknown-outcome");
    const posted = posts;
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document.querySelector(".agus-composer button").disabled ||
        !document.querySelector(".agus-error"),
    );
    assert.equal(posts, posted);
    assert.equal(await input.inputValue(), "");
    await page.route(
      "**/api/conversation",
      (route) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INVALID_ARGUMENT" } }),
        }),
      { times: 1 },
    );
    await input.fill("Retain this rejected question");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "wasn’t completed" })
      .waitFor();
    assert.equal(await input.inputValue(), "Retain this rejected question");
    await shot("recoverable-error");
    checks.push(
      "unknown after server save reconciled with zero extra POSTs; definite rejection retains input",
    );
    if (index === 0 || viewport.width === 390) {
      let release, captured;
      const held = new Promise((r) => {
        captured = r;
      });
      await page.route(
        "**/api/conversation",
        async (route) => {
          const response = await route.fetch();
          captured();
          await new Promise((r) => {
            release = r;
          });
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      const waiting = send("Hey, one more idea");
      await held;
      const source = page.locator(".agus-sources>summary").first();
      await source.focus();
      await page.locator(".agus-scroll").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(50);
      const prior = await page
        .locator(".agus-scroll")
        .evaluate((el) => el.scrollTop);
      release();
      await waiting;
      assert.equal(
        await source.evaluate((el) => document.activeElement === el),
        true,
      );
      assert.ok(
        Math.abs(
          (await page.locator(".agus-scroll").evaluate((el) => el.scrollTop)) -
            prior,
        ) < 5,
      );
      await page
        .getByRole("button", { name: "Latest response", exact: true })
        .waitFor();
      checks.push(
        "delayed completion preserves reader scroll and selected evidence focus",
      );
    }
    const rendered = await page.evaluate(() => {
      const root = document.querySelector(".agus-workspace");
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(el).visibility !== "hidden" &&
          !el.closest(".agus-sr-only")
        );
      };
      return {
        small: [...root.querySelectorAll("*")]
          .filter(
            (el) =>
              visible(el) &&
              [...el.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent.trim(),
              ) &&
              parseFloat(getComputedStyle(el).fontSize) < 13,
          )
          .map((el) => el.className),
        targets: [
          ...root.querySelectorAll("button,summary,textarea,select,input,a"),
        ]
          .filter(
            (el) =>
              visible(el) &&
              !el.matches(".agus-skip") &&
              (el.getBoundingClientRect().width < 44 ||
                el.getBoundingClientRect().height < 44),
          )
          .map((el) => el.className),
        color: [...root.querySelectorAll("*")].filter(visible).flatMap((el) =>
          ["color", "backgroundColor", "borderTopColor", "outlineColor"]
            .filter((key) => {
              const style = getComputedStyle(el);
              const c = style[key].match(/[\d.]+/g)?.map(Number);
              return c?.length >= 3 && (c[0] !== c[1] || c[1] !== c[2]);
            })
            .map((key) => `${el.className}:${key}`),
        ),
        canvas: getComputedStyle(root).backgroundColor,
      };
    });
    assert.deepEqual(rendered, {
      small: [],
      targets: [],
      color: [],
      canvas: "rgb(0, 0, 0)",
    });
    const access = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      access.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
    );
    await page.reload();
    await page.locator(".agus-assistant-message").first().waitFor();
    assert.match(
      await page
        .getByRole("button", { name: /^Account:/ })
        .getAttribute("aria-label"),
      /No account/,
    );
    await fit();
    const handoff = await send(
      "Prepare ₦500 for Ada at Wema Bank. I haven't provided her account number.",
    );
    await input.fill("Draft to resume after payment");
    await handoff
      .getByRole("button", { name: "Open payment draft", exact: false })
      .click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.locator(".proposal-summary").last().waitFor();
    await shot("payment-draft");
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    if (index === 0 || viewport.width === 390) {
      const paymentInput = page.getByLabel("Message Agus", { exact: true });
      await paymentInput.fill("Typed text\n");
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
      await page.evaluate(() => window.__voice.onerror({ error: "network" }));
      assert.equal(
        await paymentInput.inputValue(),
        "Typed text\ntranscribed text",
      );
      await page.locator(".proposal-summary>summary").last().click();
      const proposal = page
        .getByRole("region", { name: "Payment proposal", exact: true })
        .last();
      await proposal
        .getByLabel("Fictional recipient 1")
        .selectOption("0000000001");
      await proposal.getByLabel("Amount (NGN)", { exact: true }).fill("500");
      await shot("payment-editable");
      await proposal
        .getByLabel("Amount (NGN)", { exact: true })
        .fill(String(500 + index));
      await proposal
        .getByRole("button", { name: "Add recipient", exact: true })
        .click();
      await proposal
        .getByLabel("Fictional recipient 2")
        .selectOption("0000000002");
      await proposal
        .getByLabel("Amount (NGN)", { exact: true })
        .nth(1)
        .fill(String(700 + index));
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
      await card.getByRole("checkbox").waitFor();
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
      assert.equal(executions, 0, "approval never submits");
      assert.equal(approvals, 1);
      assert.equal(
        await page.locator(".composer").count(),
        0,
        "review collapses payment composer",
      );
      await card.evaluate((el) =>
        el.scrollIntoView({ block: "start", behavior: "instant" }),
      );
      await shot("payment-review");
      const paymentAccess = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        paymentAccess.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
        [],
      );
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .click();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .waitFor();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .click();
      await card.locator(".payment-row .badge.successful").waitFor();
      await card.locator(".payment-row .badge.processing").waitFor();
      await shot("payment-outcomes");
      assert.equal(executions, 1);
      checks.push(
        "fixture approval and submission are separate; unresolved recipient remains processing",
      );
    }
    const returnLink = page.locator(".return-chat");
    assert.equal(
      new URL(await returnLink.getAttribute("href"), base).searchParams.get(
        "chat",
      ),
      new URL(firstUrl).searchParams.get("chat"),
    );
    await returnLink.click();
    await page.locator(".agus-assistant-message").first().waitFor();
    await shot("payment-return");
    assert.equal(await input.inputValue(), "Draft to resume after payment");
    if (index === 0 || viewport.width === 390) {
      await page.evaluate(() =>
        window.__lateVoice?.({
          results: [{ isFinal: true, 0: { transcript: "late transcript" } }],
        }),
      );
      assert.equal(await input.inputValue(), "Draft to resume after payment");
      checks.push(
        "existing Gerald browser voice fixture appends without auto-send, preserves typed multiline, handles error and discards late transcript after return",
      );
    }
    checks.push(
      "reload clears account; explicit editable payment handoff; no approval/execution; originating chat return",
    );
    if (viewport.width === 390) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      sidebar = await nav();
      await shot("reduced-motion-drawer");
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator(".agus-send")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.setViewportSize({ width: 320, height: 420 });
      await fit();
      await shot("reduced-visual-viewport");
      await page.setViewportSize(viewport);
      // CSS zoom is a reflow stress check, not a physical OS text-zoom claim.
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await fit(false);
      await shot("zoom-200");
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
      checks.push(
        "reduced motion; 320x420 visual viewport simulation; CSS 200% zoom/reflow",
      );
    }
    const metrics = await page.evaluate(() => window.__metrics);
    if (index === 0) {
      const countBefore = posts;
      await page.route(
        "**/api/conversation",
        (route) =>
          route.fulfill({
            status: 401,
            contentType: "application/json",
            body: "{}",
          }),
        { times: 1 },
      );
      await input.fill("Retained after session expiry");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.locator(".agus-signin-hint").waitFor();
      assert.equal(await input.inputValue(), "Retained after session expiry");
      await page
        .locator(".agus-signin-hint")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Operator password", { exact: true }).isEnabled(),
        true,
      );
      await page
        .getByLabel("Operator password", { exact: true })
        .fill(password);
      await page
        .getByRole("button", { name: "Sign in securely", exact: true })
        .click();
      await page.locator(".agus-signin").waitFor({ state: "hidden" });
      assert.equal(posts, countBefore + 1);
      assert.equal(await input.inputValue(), "Retained after session expiry");
      checks.push(
        "expired response clears private content, retains current unsent text and permits sign-in without auto-send",
      );
    }
    let lateRelease;
    if (index === 0) {
      let captured;
      const saved = new Promise((r) => {
        captured = r;
      });
      await page.route(
        "**/api/conversation",
        async (route) => {
          const response = await route.fetch();
          captured();
          await new Promise((r) => {
            lateRelease = r;
          });
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await input.fill("Hey, discard my delayed response after sign-out");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await saved;
    }
    sidebar = await nav();
    await sidebar
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await page.locator(".agus-signin-hint").waitFor();
    if (lateRelease) {
      lateRelease();
      await page.waitForTimeout(150);
      checks.push(
        "late authenticated turn cannot repopulate signed-out workspace",
      );
    }
    assert.equal(await page.locator(".agus-assistant-message").count(), 0);
    assert.equal(await input.inputValue(), "");
    assert.deepEqual(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
      { local: 0, session: 0 },
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      passed: true,
      checks,
      browser: await browser.version(),
      motion: "normal; 390px also reduced",
      data: "fictional fixtures",
      inference: "mocked Gemini routing and narration; not live inference",
      approvals,
      executions,
      metrics,
    });
    if (viewport.width === 390)
      await context.tracing.stop({
        path: join(evidence, "mobile-interaction-recording.zip"),
      });
    console.log(`PASS ${viewport.width}x${viewport.height}`);
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
