/* global navigator: readonly, Blob: readonly, DOMException: readonly, KeyboardEvent: readonly, window: readonly, document: readonly */
// Focused production integration journeys. Three responsive sizes, synthetic data and mocked provider/speech only.
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { URL } from "node:url";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const base = "http://127.0.0.1:3120";
const dir = await mkdtemp(join(tmpdir(), "agus-integration-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const report =
  process.env.INTEGRATION_REPORT ?? "/tmp/agus-chat-payments-browser.json";
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-chat-payments.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3120",
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
  browser,
  lastPage;
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
    { width: 820, height: 900 },
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
      window.__audio = { speaks: 0, cancels: 0 };
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      Object.defineProperty(window, "speechSynthesis", {
        value: {
          speak(u) {
            window.__audio.speaks++;
            window.__utterance = u;
          },
          cancel() {
            window.__audio.cancels++;
          },
        },
      });
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
    lastPage = page;
    page.setDefaultTimeout(12000);
    const errors = [],
      checks = [];
    let executions = 0,
      preparations = 0,
      turns = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      if (r.url().endsWith("/execute")) executions++;
      if (r.url().endsWith("/payment-draft")) preparations++;
      if (r.url().endsWith("/api/conversation")) turns++;
    });
    const input = page.getByLabel("Message AGUS", { exact: true });
    const send = async (text) => {
      await input.fill(text);
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const r = await response;
      assert.equal(r.status(), 200);
      await page.waitForFunction(
        () =>
          document
            .querySelector(".agus-composer")
            ?.getAttribute("aria-busy") === "false",
      );
      return r.json();
    };
    await page.goto(base);
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    if (viewport.width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    await input.fill("first line");
    await input.press(viewport.width >= 700 ? "Shift+Enter" : "Enter");
    assert.equal(await input.inputValue(), "first line\n");
    await input.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    assert.equal(turns, 0);
    // Modal sidebar closes when another modal opens; desktop sidebar remains.
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .waitFor({ state: "visible" });
    await input.fill("Typed first");
    const turnCount = turns;
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page.evaluate(() =>
      window.__voice.onresult({
        results: [{ 0: { transcript: "dictated words" }, isFinal: true }],
      }),
    );
    await input.fill("Edited while recording");
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    assert.equal(
      await input.inputValue(),
      "Edited while recording dictated words",
    );
    assert.equal(turns, turnCount);
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page.evaluate(() => {
      window.__lateVoice = window.__voice.onresult;
    });
    await page
      .getByRole("button", { name: "Cancel recording", exact: true })
      .click();
    await page.evaluate(() =>
      window.__lateVoice({ results: [{ 0: { transcript: "discarded" } }] }),
    );
    assert.equal(
      await input.inputValue(),
      "Edited while recording dictated words",
    );
    const mic = await page
      .getByRole("button", { name: "Start recording", exact: true })
      .boundingBox();
    const sendBox = await page
      .getByRole("button", { name: "Send message", exact: true })
      .boundingBox();
    assert.ok(mic.x < sendBox.x && Math.abs(mic.y - sendBox.y) < 4);
    checks.push(
      "Microphone beside Send, stop appends to current edited draft, cancel rejects late callbacks, no automatic send",
    );
    if (viewport.width === 1440) {
      await page.evaluate(() => {
        window.__recognitionConstructor = window.SpeechRecognition;
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
        window.__tracksStopped = 0;
        window.__stream = () => ({
          getTracks: () => [
            {
              stop() {
                window.__tracksStopped++;
              },
            },
          ],
        });
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: { getUserMedia: async () => window.__stream() },
        });
        window.AudioContext = class {
          state = "running";
          async resume() {}
          async close() {
            this.state = "closed";
          }
          createAnalyser() {
            return {
              fftSize: 512,
              getByteTimeDomainData(data) {
                data.fill(128);
              },
            };
          }
          createMediaStreamSource() {
            return { connect() {} };
          }
        };
        window.MediaRecorder = class {
          static isTypeSupported() {
            return true;
          }
          state = "inactive";
          mimeType = "audio/webm";
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            this.ondataavailable?.({
              data: new Blob(["fictional-audio"], { type: this.mimeType }),
            });
            this.onstop?.();
          }
        };
      });
      await page.route("**/api/voice", (r) =>
        r.fulfill({ json: { transcript: "recorded words" } }),
      );
      await input.fill("Fallback draft");
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("#financial-message").value ===
          "Fallback draft recorded words",
      );
      assert.ok(await page.evaluate(() => window.__tracksStopped >= 1));
      await page.unroute("**/api/voice");
      let releaseTranscription;
      await page.route("**/api/voice", async (r) => {
        await new Promise((resolve) => {
          releaseTranscription = resolve;
        });
        await r
          .fulfill({ json: { transcript: "late transcript" } })
          .catch(() => {});
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page
        .getByText("Transcribing your recording…", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Cancel recording", exact: true })
        .click();
      releaseTranscription?.();
      await page.unroute("**/api/voice");
      assert.equal(await input.inputValue(), "Fallback draft recorded words");
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () =>
          new Promise((resolve) => {
            window.__permissionResolve = resolve;
          });
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByText("Requesting microphone access…", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Cancel recording", exact: true })
        .click();
      const stopped = await page.evaluate(() => window.__tracksStopped);
      await page.evaluate(() => window.__permissionResolve(window.__stream()));
      await page.waitForFunction((n) => window.__tracksStopped > n, stopped);
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException(
            "fixture permission denied",
            "NotAllowedError",
          );
        };
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page.getByText(/Microphone access was denied/).waitFor();
      assert.equal(await input.inputValue(), "Fallback draft recorded words");
      assert.equal(turns, turnCount);
      await page.evaluate(() => {
        window.SpeechRecognition = window.__recognitionConstructor;
      });
      checks.push(
        "Mocked MediaRecorder/provider transcription appends without sending; tracks close; cancelled transcription and late permission are discarded; permission denial preserves typed text",
      );
    }
    const hello = await send("Hello");
    assert.equal(hello.reply.kind, "general");
    const education = await send("What is inflation?");
    assert.equal(education.reply.kind, "general");
    assert.match(education.reply.text, /purchasing power/);
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Account:/ })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    if (viewport.width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    const totals = await send("Show my spending for October 2026");
    assert.equal(totals.reply.kind, "financial");
    assert.match(totals.reply.text, /₦19,751.51/);
    assert.match(totals.reply.text, /₦250,000.00/);
    assert.match(totals.reply.text, /₦230,248.49/);
    const total = page.locator(".agus-assistant-message").last();
    assert.equal(await total.locator(".agus-fallback").count(), 0);
    await total.locator(".agus-sources>summary").click();
    const matches = await send("Find payments to Ada in October 2026");
    assert.equal(matches.reply.kind, "clarify");
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
    assert.equal(executions, 0);
    checks.push(
      "Same mocked Gemini conversation adapter: general/education, account-scoped SQL totals, accepted narration, expandable evidence, ambiguous candidates and three-tool historical investigation",
    );
    assert.equal(await page.evaluate(() => window.__audio.speaks), 0);
    await page
      .getByRole("button", { name: "Listen to response", exact: true })
      .first()
      .click();
    assert.equal(await page.evaluate(() => window.__audio.speaks), 1);
    await page.evaluate(() => {
      window.__oldPlaybackEnd = window.__utterance.onend;
    });
    await page
      .getByRole("button", { name: "Listen to response", exact: true })
      .last()
      .click();
    await page.evaluate(() => window.__oldPlaybackEnd());
    assert.equal(
      await page
        .getByRole("button", { name: "Stop reading response", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Stop reading response", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Listen to response", exact: true })
      .first()
      .click();
    const savedCount = await page.locator(".agus-assistant-message").count();
    await page.route(
      "**/api/conversation",
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 },
    );
    await input.fill("Hello, save this response");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .click();
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll(".agus-assistant-message").length === n + 1,
      savedCount,
    );
    assert.equal(await input.inputValue(), "");
    checks.push(
      "Keyboard newline/IME and saved conversation recovery after a lost response without replay",
    );
    const draft = await send(
      "Prepare 500 to Ada at Wema account 0000000001 for Lunch and 600 to Chidi at Access account 0000000002 for Books",
    );
    assert.equal(draft.reply.kind, "handoff");
    assert.equal(
      await page.getByRole("button", { name: "Stop reading response" }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Prepare payment draft", exact: true })
      .click();
    const card = page.locator(".agus-thread .agus-payment").last();
    await card.locator("summary").first().click();
    const editor = card.getByRole("region", {
      name: "Payment proposal",
      exact: true,
    });
    await editor
      .getByLabel("Recipient label", { exact: true })
      .first()
      .waitFor();
    assert.equal(await editor.locator("fieldset").count(), 2);
    await editor.getByLabel("Amount (NGN)", { exact: true }).nth(1).fill("650");
    await editor
      .getByLabel("Description", { exact: true })
      .nth(1)
      .fill("Edited books");
    await editor.getByLabel("Description", { exact: true }).nth(1).blur();
    await editor.getByText("Changes saved", { exact: true }).waitFor();
    const url = page.url();
    await page.reload();
    await page.locator(".agus-thread .agus-payment").last().waitFor();
    await page
      .locator(".agus-thread .agus-payment")
      .last()
      .locator("summary")
      .first()
      .click();
    assert.equal(
      await editor
        .getByLabel("Amount (NGN)", { exact: true })
        .nth(1)
        .inputValue(),
      "650",
    );
    assert.equal(preparations, 1);
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    const batch = card.locator(".batch-card");
    await batch
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    await batch.getByRole("checkbox").check();
    await batch
      .getByLabel("Password to approve reviewed batch", { exact: true })
      .fill(password);
    await batch
      .getByRole("button", { name: "Approve reviewed batch", exact: true })
      .click();
    await batch
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .waitFor();
    assert.equal(executions, 0);
    // Editing a reviewed batch must invalidate approval and require verification again.
    await batch
      .getByRole("button", { name: "Edit instructions", exact: true })
      .click();
    await card.getByLabel("Amount (NGN)", { exact: true }).first().fill("450");
    await card
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    assert.equal(
      await batch
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .count(),
      0,
    );
    await batch
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    await batch.getByRole("checkbox").check();
    await batch
      .getByLabel("Password to approve reviewed batch", { exact: true })
      .fill(password);
    await batch
      .getByRole("button", { name: "Approve reviewed batch", exact: true })
      .click();
    // Drop the HTTP response after the real fixture engine has consumed approval.
    await page.route("**/api/batches/*/execute", async (route) => {
      await route.fetch();
      await route.abort("connectionfailed");
    });
    await batch
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .click();
    await batch
      .getByRole("button", { name: "Check provider", exact: true })
      .waitFor();
    const before = await page.request
      .get(`${base}/api/state`)
      .then((r) => r.json());
    const refs = before.batches[0].payments.map((p) => p.reference);
    await page.reload();
    await card.locator("summary").first().click();
    await batch
      .getByRole("button", { name: "Check provider", exact: true })
      .waitFor();
    assert.equal(executions, 1);
    assert.equal(
      await batch
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .count(),
      0,
    );
    await batch
      .getByRole("button", { name: "Check provider", exact: true })
      .click();
    await batch.locator(".payment-row .badge.successful").waitFor();
    await batch.locator(".payment-row .badge.processing").waitFor();
    const after = await page.request
      .get(`${base}/api/state`)
      .then((r) => r.json());
    assert.deepEqual(
      after.batches[0].payments.map((p) => p.reference),
      refs,
    );
    assert.equal(
      after.batches[0].approval.consumedAt,
      before.batches[0].approval.consumedAt,
    );
    checks.push(
      "Two recipients, persisted edits, approval invalidated by edit, separate password approval/submission, lost response recovery, reload retains references and successful/pending outcomes with one execution POST",
    );
    assert.equal(
      await card.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    const accessibility = await new AxeBuilder({ page })
      .include(".agus-workspace")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      accessibility.violations.map((v) => ({ id: v.id, impact: v.impact })),
      [],
    );
    checks.push(
      "Expanded payment card has no horizontal overflow or automated WCAG A/AA violations",
    );
    // Verify drawer and history navigation at each requested width.
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Saved payments", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close saved payments", exact: true })
      .click();
    if (viewport.width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    if (viewport.width === 1440) {
      // A proposal made by the historical API has no chat linkage, and must still
      // be recoverable from the unified history disclosure.
      const legacy = await page.request.post(`${base}/api/chat`, {
        headers: { origin: base },
        data: { message: "Prepare payment for Ada; details are missing" },
      });
      assert.equal(legacy.status(), 200);
    }
    // Existing workspace links are retired into the same chat, with historical cards.
    await page.goto(
      `${base}/?fromChat=${new URL(url).searchParams.get("chat")}`,
    );
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .waitFor();
    assert.ok(page.url().includes("/conversation?payments=history"));
    if (viewport.width === 1440)
      await page
        .getByRole("dialog", { name: "Saved payments", exact: true })
        .getByText(/Editable draft/)
        .first()
        .waitFor();
    await page
      .getByRole("button", { name: "Close saved payments", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Listen to response", exact: true })
      .first()
      .waitFor();
    assert.equal(await page.evaluate(() => window.__audio.speaks), 0);
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
    await mkdir("/tmp/agus-chat-payments-screens", { recursive: true });
    await page.screenshot({
      path: `/tmp/agus-chat-payments-screens/${viewport.width}.png`,
    });
    // Navigation discards a recording callback and stops response playback.
    await page
      .getByRole("button", { name: "Listen to response", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page.evaluate(() => {
      window.__lateVoice = window.__voice.onresult;
    });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.evaluate(() =>
      window.__lateVoice({
        results: [{ 0: { transcript: "must not enter new chat" } }],
      }),
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page.evaluate(() => {
      window.__logoutLateVoice = window.__voice.onresult;
    });
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign out", exact: true })
      .filter({ visible: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector("button[aria-label='Sign out']"),
    );
    await page.evaluate(() =>
      window.__logoutLateVoice({
        results: [{ 0: { transcript: "must not enter after logout" } }],
      }),
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(await page.locator(".agus-payment").count(), 0);
    assert.deepEqual(errors, []);
    checks.push(
      "Saved payment history, legacy links, sidebar/drawer close, visible composer, no overflow/page errors, no automatic playback after reload, recording cleanup on new chat",
    );
    results.push({
      viewport,
      passed: true,
      checks,
      preparations,
      executions,
      errors,
    });
    console.log(`PASS ${viewport.width}px: ${checks.length} integrated groups`);
    await context.close();
  }
  await mkdir(dirname(report), { recursive: true });
  await writeFile(
    report,
    JSON.stringify(
      {
        model: "mocked Gemini HTTP",
        speech: "mocked browser APIs",
        data: "fictional",
        paymentMode: "fixture",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  if (lastPage) {
    console.error(await lastPage.locator("body").innerText());
    await lastPage.screenshot({ path: "/tmp/agus-chat-payments-failure.png" });
  }
  throw e;
} finally {
  await browser?.close();
  const stopped = new Promise((r) => child.once("exit", r));
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
