/* global window: readonly, document: readonly, navigator: readonly, KeyboardEvent: readonly, Event: readonly, Blob: readonly */
// Reentrant submission at API entry, before React commits disabled controls.
// Fictional data, local SQL/auth, mocked model/speech/recording/transcription.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = "http://127.0.0.1:3121";
const dir = await mkdtemp(join(tmpdir(), "agus-voice-submit-"));
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-chat-payments.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3121",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "voice-submit-fixture",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      LIVE_TRANSFERS_ENABLED: "false",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "browser-mock-inference-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  browser;
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
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
      /* startup */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const width of [1440, 820, 390, 320].filter(
    (w) =>
      !process.env.BROWSER_WIDTHS ||
      process.env.BROWSER_WIDTHS.split(",").includes(String(w)),
  )) {
    for (const mode of ["native", "media"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        isMobile: width < 700,
        hasTouch: width < 700,
      });
      const checks = [];
      try {
        await context.route("**/*", (r) =>
          r.request().url().startsWith(base) ? r.continue() : r.abort(),
        );
        await context.addInitScript((mode) => {
          window.__posts = 0;
          window.__stops = 0;
          window.__tracks = 0;
          const transport = window.fetch;
          window.fetch = (input, init) => {
            if (
              String(input).endsWith("/api/conversation") &&
              init?.method === "POST"
            )
              window.__posts++;
            return transport(input, init);
          };
          window.__attemptSubmit = () => {
            const input = document.querySelector("#financial-message"),
              form = input.closest("form");
            const before = {
              draft: input.value,
              messages: document.querySelectorAll(".agus-thread article")
                .length,
              posts: window.__posts,
            };
            // Each mechanism reaches the shared handler, including the stale
            // enabled Send control during synchronous startup.
            input.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
              }),
            );
            form.querySelector("button[aria-label='Send message']")?.click();
            form.dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            );
            return {
              before,
              after: {
                draft: input.value,
                messages: document.querySelectorAll(".agus-thread article")
                  .length,
                posts: window.__posts,
              },
            };
          };
          window.__probe = () => {
            window.__startupReadOnly =
              document.querySelector("#financial-message").readOnly;
            window.__startup = window.__attemptSubmit();
          };
          if (mode === "native")
            window.SpeechRecognition = class {
              constructor() {
                window.__recognition = this;
              }
              start() {
                window.__probe();
              } // Deliberately pending; onstart comes later.
              stop() {
                window.__stops++;
                this.onend?.();
              }
            };
          else {
            window.SpeechRecognition = undefined;
            window.webkitSpeechRecognition = undefined;
            Object.defineProperty(navigator, "mediaDevices", {
              configurable: true,
              value: {
                getUserMedia: () => {
                  window.__probe();
                  return new Promise((resolve) => {
                    window.__permission = () =>
                      resolve({
                        getTracks: () => [
                          {
                            stop() {
                              window.__tracks++;
                            },
                          },
                        ],
                      });
                  });
                },
              },
            });
            window.MediaRecorder = class {
              static isTypeSupported() {
                return true;
              }
              state = "inactive";
              mimeType = "audio/webm";
              start() {
                this.state = "recording";
                window.__recorder = this;
              }
              stop() {
                window.__stops++;
                this.state = "inactive";
                this.ondataavailable?.({
                  data: new Blob(["fictional-audio"], { type: this.mimeType }),
                });
                this.onstop?.();
              }
            };
            window.AudioContext = undefined;
          }
        }, mode);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        let posts = 0;
        page.on("request", (r) => {
          if (r.url().endsWith("/api/conversation") && r.method() === "POST")
            posts++;
        });
        let releaseTranscription;
        await page.route("**/api/voice", async (r) => {
          await new Promise((resolve) => {
            releaseTranscription = resolve;
          });
          await r
            .fulfill({ json: { transcript: "dictated words" } })
            .catch(() => {});
        });
        await page.goto(base);
        // The initial unauthenticated refresh clears private state. Wait for
        // its loading state to settle before entering the operator password.
        await page.waitForFunction(() => {
          const input = document.querySelector("#financial-message");
          return input && !input.readOnly;
        });
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .filter({ visible: true })
          .click();
        await page
          .getByLabel("Operator password", { exact: true })
          .fill(password);
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page.locator(".agus-signin").waitFor({ state: "hidden" });
        const input = page.getByLabel("Message AGUS", { exact: true });
        const button = (name) =>
          page.getByRole("button", { name, exact: true });
        const blocked = async (draft) => {
          const snapshot = await page.evaluate(() => window.__attemptSubmit());
          assert.deepEqual(
            snapshot.after,
            snapshot.before,
            "blocked submission changes no draft, pending message, history or POST count",
          );
          assert.equal(await input.inputValue(), draft);
          assert.equal(posts, 0);
          assert.equal(await page.locator(".agus-thread article").count(), 0);
          assert.equal(
            await page.locator(".agus-composer").getAttribute("aria-busy"),
            "false",
          );
        };
        const start = async () => {
          await button("Start recording").click();
          const snapshot = await page.evaluate(() => ({
            probe: window.__startup,
            readOnly: window.__startupReadOnly,
            stops: window.__stops,
          }));
          assert.equal(
            snapshot.readOnly,
            false,
            "probe executes before React locks the composer",
          );
          assert.deepEqual(
            snapshot.probe.after,
            snapshot.probe.before,
            "synchronous startup must not submit",
          );
          assert.equal(snapshot.stops, 0, "attempt must not cancel capture");
        };
        await input.fill("Preserved typed draft");
        await start();
        await blocked("Preserved typed draft");
        checks.push(
          "Synchronous API startup and pending permission: keyboard, Send and programmatic form submit preserve draft/history with zero conversation POSTs",
        );
        // Cancel pending permission, then invoke saved callbacks after cleanup.
        if (mode === "native")
          await page.evaluate(() => {
            window.__late = window.__recognition.onresult;
          });
        await button("Cancel recording").click();
        if (mode === "media") await page.evaluate(() => window.__permission());
        else
          await page.evaluate(() =>
            window.__late({
              results: [{ 0: { transcript: "discarded" }, isFinal: true }],
            }),
          );
        assert.equal(await input.inputValue(), "Preserved typed draft");
        await page.evaluate(() => {
          window.__stops = 0;
        });
        await start();
        if (mode === "native")
          await page.evaluate(() => window.__recognition.onstart());
        else await page.evaluate(() => window.__permission());
        await button("Stop recording").waitFor();
        await blocked("Preserved typed draft");
        assert.equal(await page.evaluate(() => window.__stops), 0);
        checks.push(
          "Active capture: prohibited submission does not stop recording or create a pending message",
        );
        if (mode === "native")
          await page.evaluate(() =>
            window.__recognition.onresult({
              results: [{ 0: { transcript: "dictated words" }, isFinal: true }],
            }),
          );
        await button("Stop recording").click();
        if (mode === "media") {
          await page
            .getByText("Transcribing your recording…", { exact: true })
            .waitFor();
          await blocked("Preserved typed draft");
          checks.push(
            "Transcription: submission blocked, original text and history retained, zero conversation POSTs",
          );
          releaseTranscription();
        }
        await page.waitForFunction(
          () =>
            document.querySelector("#financial-message").value ===
            "Preserved typed draft dictated words",
        );
        assert.equal(posts, 0);
        assert.equal(await input.evaluate((el) => el.readOnly), false);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/conversation") &&
            r.request().method() === "POST",
        );
        await button("Send message").click();
        const saved = await (await response).json();
        assert.equal(saved.turn.text, "Preserved typed draft dictated words");
        await page.waitForFunction(
          () =>
            document
              .querySelector(".agus-composer")
              .getAttribute("aria-busy") === "false",
        );
        assert.equal(posts, 1);
        assert.equal(await input.inputValue(), "");
        checks.push(
          "Completion unlocks deliberate submission of the preserved draft plus transcript exactly once",
        );
        // Navigation invalidates late recognition, permission and transcription.
        await input.fill("Navigation draft");
        await page.evaluate(() => {
          window.__probe = () => {};
        });
        await button("Start recording").click();
        if (mode === "native")
          await page.evaluate(() => {
            window.__late = window.__recognition.onresult;
          });
        await button("New chat").filter({ visible: true }).last().click();
        if (mode === "native")
          await page.evaluate(() =>
            window.__late({
              results: [{ 0: { transcript: "late" }, isFinal: true }],
            }),
          );
        else {
          const n = await page.evaluate(() => window.__tracks);
          await page.evaluate(() => window.__permission());
          await page.waitForFunction((n) => window.__tracks > n, n);
        }
        assert.equal(await input.inputValue(), "");
        assert.equal(await input.evaluate((el) => el.readOnly), false);
        assert.equal(posts, 1);
        assert.deepEqual(errors, []);
        checks.push(
          "Navigation discards late callbacks, closes late permission streams and leaves the new composer unlocked",
        );
        results.push({
          width,
          mode,
          passed: true,
          checks,
          conversationPosts: posts,
          pageErrors: errors,
        });
        console.log(
          `PASS voice submit ${mode} ${width}px: ${checks.length} groups`,
        );
      } catch (error) {
        results.push({
          width,
          mode,
          passed: false,
          error: String(error),
          checks,
        });
        console.error(`FAIL voice submit ${mode} ${width}px: ${error}`);
        process.exitCode = 1;
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(
    process.env.VOICE_SUBMIT_REPORT ?? "/tmp/agus-voice-submit.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once("exit", r),
  );
  await rm(dir, { recursive: true, force: true });
}
