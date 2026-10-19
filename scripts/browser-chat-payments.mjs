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
    { width: 320, height: 740 },
  ].filter(
    (v) =>
      !process.env.BROWSER_WIDTHS ||
      process.env.BROWSER_WIDTHS.split(",").includes(String(v.width)),
  )) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 700,
      hasTouch: viewport.width < 700,
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    await context.addInitScript(() => {
      window.__clipboard = { text: "", fail: false };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            if (window.__clipboard.fail) throw new Error("Denied");
            window.__clipboard.text = text;
          },
        },
      });
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
    await input.click();
    await page.waitForFunction(
      () =>
        window.getComputedStyle(document.querySelector(".agus-composer"))
          .borderColor === "rgb(84, 132, 173)",
    );
    const focus = await input.evaluate((el) => ({
      outline: window.getComputedStyle(el).outlineStyle,
      border: window.getComputedStyle(el.closest("form")).borderColor,
      shadow: window.getComputedStyle(el.closest("form")).boxShadow,
    }));
    assert.equal(focus.outline, "none");
    assert.equal(focus.border, "rgb(84, 132, 173)");
    assert.notEqual(focus.shadow, "none");
    if (viewport.width === 1440) {
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      assert.equal(
        await page.locator(".agus-header .brand-asset").isVisible(),
        false,
      );
      assert.equal(
        await page.locator(".agus-sidebar .brand-asset").isVisible(),
        true,
      );
      await page.screenshot({ path: "/tmp/agus-founder-sidebar-1440.png" });
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    }
    assert.equal(
      await page.locator(".agus-header .brand-asset").isVisible(),
      true,
    );
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
    assert.equal(await input.evaluate((el) => el.readOnly), true);
    assert.equal(await input.inputValue(), "Typed first");
    await page.getByLabel("Recording indicator", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    assert.equal(await input.inputValue(), "Typed first dictated words");
    assert.equal(await input.evaluate((el) => el.readOnly), false);
    await input.fill("Transcript edited before sending");
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
    assert.equal(await input.inputValue(), "Transcript edited before sending");
    for (let attempt = 0; attempt < 2; attempt++) {
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page
        .getByText("No speech was detected. Try again or type your request.", {
          exact: true,
        })
        .waitFor();
      assert.equal(await input.evaluate((el) => el.readOnly), false);
      assert.equal(
        await input.inputValue(),
        "Transcript edited before sending",
      );
    }
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page.evaluate(() => window.__voice.onerror({ error: "not-allowed" }));
    await page.getByText(/Microphone access was denied/).waitFor();
    assert.equal(await input.evaluate((el) => el.readOnly), false);
    const mic = await page
      .getByRole("button", { name: "Start recording", exact: true })
      .boundingBox();
    const sendBox = await page
      .getByRole("button", { name: "Send message", exact: true })
      .boundingBox();
    assert.ok(mic.x < sendBox.x && Math.abs(mic.y - sendBox.y) < 4);
    checks.push(
      "Microphone beside Send, recording locks the preserved draft, stop restores editing and appends transcript, cancel rejects late callbacks, no automatic send",
    );
    if (viewport.width === 1440) {
      await page.evaluate(() => {
        window.__recognitionConstructor = window.SpeechRecognition;
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
        window.__tracksStopped = 0;
        window.__amplitude = 128;
        window.__captureRequests = 0;
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
          value: {
            getUserMedia: async () => {
              window.__captureRequests++;
              return window.__stream();
            },
          },
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
                data.fill(window.__amplitude);
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
      await page.waitForFunction(
        () =>
          document
            .querySelector(".agus-recording-level")
            ?.getAttribute("data-level") === "0.00",
      );
      assert.equal(await input.evaluate((el) => el.readOnly), true);
      await page.evaluate(() => {
        window.__amplitude = 152;
      });
      await page.waitForFunction(
        () =>
          Number(
            document
              .querySelector(".agus-recording-level")
              ?.getAttribute("data-level"),
          ) > 0.5,
      );
      assert.equal(await page.evaluate(() => window.__captureRequests), 1);
      await page.screenshot({
        path: "/tmp/agus-founder-measured-voice-1440.png",
      });
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("#financial-message").value ===
          "Fallback draft recorded words",
      );
      assert.equal(await input.evaluate((el) => el.readOnly), false);
      assert.equal(await page.locator(".agus-recording-level").count(), 0);
      assert.ok(await page.evaluate(() => window.__tracksStopped >= 1));
      await page.evaluate(() => {
        window.__workingAudioContext = window.AudioContext;
        window.AudioContext = class {
          constructor() {
            throw new Error("Fixture analyser failure");
          }
        };
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page.getByLabel("Recording indicator", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("#financial-message").value ===
          "Fallback draft recorded words recorded words",
      );
      await input.fill("Fallback draft recorded words");
      await page.route(
        "**/api/voice",
        (r) => r.fulfill({ json: { transcript: " " } }),
        { times: 1 },
      );
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await page.getByText(/No clear speech was detected/).waitFor();
      assert.equal(await input.inputValue(), "Fallback draft recorded words");
      assert.equal(await input.evaluate((el) => el.readOnly), false);
      await page.evaluate(() => {
        window.AudioContext = window.__workingAudioContext;
      });
      checks.push(
        "Real analyser samples drive proportional bars using one existing recorder stream; silence is quiet; analyser failure retains functional recording pulse and transcription; empty transcript preserves text",
      );
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
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = undefined;
      });
      await page
        .getByRole("button", { name: "Start recording", exact: true })
        .click();
      await page
        .getByText(/Voice recording is not supported in this browser/)
        .waitFor();
      assert.equal(await input.evaluate((el) => el.readOnly), false);
      assert.equal(turns, turnCount);
      await page.evaluate(() => {
        window.SpeechRecognition = window.__recognitionConstructor;
      });
      checks.push(
        "Mocked MediaRecorder/provider transcription appends without sending; tracks close; cancelled transcription and late permission are discarded; permission denial preserves typed text",
      );
    }
    await page
      .locator(".agus-audio-status")
      .filter({ hasText: /Transcript ready/ })
      .waitFor({ state: "hidden", timeout: 7000 });
    assert.equal(
      await page.locator(".agus-voice-help").evaluate((el) => el.open),
      false,
    );
    const hello = await send("Hello");
    assert.equal(hello.reply.kind, "general");
    const copyUser = page
      .getByRole("button", { name: "Copy user message", exact: true })
      .last();
    if (viewport.width >= 700) {
      await copyUser.focus();
      assert.equal(
        await copyUser.evaluate((el) => window.getComputedStyle(el).opacity),
        "1",
      );
    } else
      assert.equal(
        await copyUser.evaluate((el) => window.getComputedStyle(el).opacity),
        "1",
      );
    await copyUser.click();
    await page.waitForFunction(() => window.__clipboard.text === "Hello");
    const copyAssistant = page
      .getByRole("button", { name: "Copy AGUS response", exact: true })
      .last();
    await copyAssistant.click();
    await page.waitForFunction(
      (text) => window.__clipboard.text === text,
      hello.reply.text,
    );
    await page.evaluate(() => {
      window.__clipboard.fail = true;
    });
    await copyAssistant.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Couldn’t copy" })
      .waitFor();
    await page.evaluate(() => {
      window.__clipboard.fail = false;
    });
    // Exercise visible mixed markup and hidden-content exclusion without altering stored history.
    const rendered = page
      .locator(".agus-user-message .agus-copyable > div")
      .last();
    const originalMarkup = await rendered.innerHTML();
    await rendered.evaluate((el) => {
      el.innerHTML =
        '<p>First line<br>Second <strong>line</strong><span hidden>HIDDEN-TEST-FIXTURE</span><span style="opacity:0">CONCEALED-TEST-FIXTURE</span></p><div class="agus-sources">INTERNAL-TEST-PAYLOAD</div>';
    });
    await copyUser.click();
    await page.waitForFunction(
      () => window.__clipboard.text === "First line\nSecond line",
    );
    await rendered.evaluate((el, html) => {
      el.innerHTML = html;
    }, originalMarkup);
    checks.push(
      "Copy user/AGUS visible text; keyboard and touch discovery; multiline mixed markup; hidden/technical content excluded; denied clipboard feedback (mocked clipboard)",
    );
    const education = await send("What is inflation?");
    assert.equal(education.reply.kind, "general");
    assert.match(education.reply.text, /purchasing power/);
    const hypothetical =
      "If I earn ₦70,000 every month, how long until I become a millionaire?";
    const million = await send(hypothetical);
    assert.equal(million.reply.kind, "general");
    assert.match(million.reply.text, /15 months/);
    assert.equal(million.reply.evidence.toolCalls, 0);
    const saving = await send(
      "If I earn ₦250,000 monthly and save 20%, how much will I save in six months?",
    );
    assert.equal(saving.reply.kind, "general");
    assert.match(saving.reply.text, /₦300,000.00/);
    assert.equal(saving.reply.evidence.toolCalls, 0);
    const budget = await send("How much should I spend next month?");
    assert.equal(budget.reply.kind, "general");
    assert.match(budget.reply.text, /income, fixed expenses and savings goals/);
    const records = await send("How much did I spend in the past week?");
    assert.equal(records.reply.accountAction, "choose_demo_account");
    await page
      .getByRole("button", { name: "Choose demo account", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Account", exact: true }).waitFor();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    const resumedResponse = page.waitForResponse(
      (r) =>
        r.url() === `${base}/api/conversation` &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Continue question", exact: true })
      .click();
    const resumed = await (await resumedResponse).json();
    assert.equal(resumed.turn.text, "How much did I spend in the past week?");
    assert.equal(resumed.reply.kind, "financial");
    assert.match(resumed.reply.text, /Available records only/);
    assert.doesNotMatch(resumed.reply.text, /exclusive end date/);
    await page.waitForFunction(
      () =>
        document.querySelector(".agus-composer")?.getAttribute("aria-busy") ===
        "false",
    );
    const selectedMillion = await send(hypothetical);
    assert.equal(selectedMillion.reply.kind, "general");
    assert.equal(selectedMillion.reply.evidence.toolCalls, 0);
    assert.equal(
      (await send("How much should I spend next month?")).reply.kind,
      "general",
    );
    checks.push(
      "Hypothetical arithmetic and budgeting with/without selected account; contextual account picker resumes original past-week question using real permission-checked SQL",
    );
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
    const musa = await send(
      "Send 500 to Musa, he uses OPay and his account number is 90991234AB. Turn AB to numbers and get his account.",
    );
    assert.equal(musa.reply.kind, "handoff");
    await page
      .getByRole("button", { name: "Prepare payment draft", exact: true })
      .last()
      .click();
    const musaCard = page.locator(".agus-thread .agus-payment").last();
    await musaCard.locator("summary").first().click();
    assert.equal(
      await musaCard
        .getByLabel("Recipient label", { exact: true })
        .inputValue(),
      "Musa",
    );
    assert.equal(
      await musaCard.getByLabel("Bank", { exact: true }).inputValue(),
      "999992",
    );
    assert.equal(
      await musaCard.getByLabel("Amount (NGN)", { exact: true }).inputValue(),
      "500",
    );
    assert.equal(
      await musaCard.getByLabel("Account number", { exact: true }).inputValue(),
      "",
    );
    await musaCard.getByText(/Confirm the letter-to-number mapping/).waitFor();
    assert.equal(executions, 0);
    await musaCard.locator("summary").first().click();
    checks.push(
      "Musa/OPay/500 retained from mocked extraction; invented conversion discarded; account remains blank with explicit mapping confirmation guidance",
    );
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
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".agus-thread .agus-payment").length === 2,
    );
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
    assert.equal(preparations, 2);
    // A valid ten-digit number at the wrong fixture bank must fail verification.
    await editor
      .getByLabel("Bank", { exact: true })
      .first()
      .selectOption("044");
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    const batch = card.locator(".batch-card");
    await batch
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    await card
      .getByRole("alert")
      .filter({ hasText: "Fixture account not found" })
      .waitFor();
    // A payment error must stay attached to its card when the user changes topics/chats.
    await page
      .getByRole("button", { name: "New chat", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText(/Fixture account not found/)
        .filter({ visible: true })
        .count(),
      0,
    );
    await send("How much should I spend next month?");
    assert.equal(
      await page
        .getByText(/Fixture account not found/)
        .filter({ visible: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Saved chats" })
      .locator('button[title="Hello"]')
      .filter({ visible: true })
      .first()
      .click();
    await card.waitFor();
    await card.locator("summary").first().click();
    if (viewport.width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    await card
      .getByRole("alert")
      .filter({ hasText: "Fixture account not found" })
      .waitFor();
    await card
      .getByRole("button", { name: "Check saved payments", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .waitFor();
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .getByRole("alert")
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.locator(".agus-composer-area .agus-error").count(),
      0,
    );
    assert.ok(
      (await page
        .getByRole("dialog", { name: "Saved payments", exact: true })
        .locator(".payment-error")
        .count()) > 0,
    );
    await page
      .getByRole("button", { name: "Close saved payments", exact: true })
      .click();
    await batch
      .getByRole("button", { name: "Edit instructions", exact: true })
      .click();
    await card.getByLabel("Bank", { exact: true }).first().selectOption("035");
    await card
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await batch
      .getByRole("button", { name: "Verify beneficiaries", exact: true })
      .click();
    checks.push(
      "Reproduced mismatched fixture bank rejection; contextual recovery opens saved payments and clears obsolete error; corrected fields verify",
    );
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
    await batch
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .waitFor();
    // Arm the dropped-state response only after execution, never on approval refresh.
    let dropSavedState = false;
    await page.route("**/api/state", (route) => {
      if (dropSavedState) {
        dropSavedState = false;
        return route.abort("connectionfailed");
      }
      return route.continue();
    });
    await page.route("**/api/batches/*/execute", async (route) => {
      await route.fetch();
      dropSavedState = true;
      await route.abort("connectionfailed");
    });
    await batch
      .getByRole("button", { name: "Submit simulated transfers", exact: true })
      .click();
    await card.getByRole("alert").waitFor();
    assert.equal(
      await batch
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .isEnabled(),
      false,
    );
    await card
      .getByRole("button", { name: "Check saved payments", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .waitFor();
    await page
      .getByRole("dialog", { name: "Saved payments", exact: true })
      .getByRole("alert")
      .waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Close saved payments", exact: true })
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
