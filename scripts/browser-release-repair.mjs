/* global document: readonly */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const base = "http://localhost:3110";
const evidence =
  process.env.REPAIR_SCREENSHOT_DIR ?? "/tmp/agus-repair-browser";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
});
const results = [];
try {
  for (const mode of ["fixture", "test", "live"]) {
    const dir = await mkdtemp(join(tmpdir(), "agus-repair-"));
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
        "3110",
        "--hostname",
        "127.0.0.1",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: `pglite://${dir}`,
          PAYMENT_MODE: mode,
          PAYSTACK_SECRET_KEY: "",
          AI_PROVIDER: "gemini",
          AI_API_KEY: "browser-mock-inference-only",
          OPERATOR_ID: "repair-operator",
          OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
          APP_ORIGIN: base,
          NEXT_TELEMETRY_DISABLED: "1",
          LIVE_TRANSFERS_ENABLED: "false",
          LIVE_OWNER_AUTHORIZED: "false",
          PAYSTACK_TRANSFERS_ENABLED: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
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
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          let mutations = 0;
          page.on("request", (r) => {
            if (/\/(approve|execute)$/.test(r.url())) mutations++;
          });
          // This check must never contact a payment or model provider.
          await context.route("**/*", (route) =>
            route.request().url().startsWith(base)
              ? route.continue()
              : route.abort(),
          );
          await page.goto(base);
          const disclosure = await page.locator(".demo-notice").innerText();
          assert.match(
            disclosure,
            mode === "fixture"
              ? /local fixture simulation/
              : mode === "test"
                ? /Paystack test mode/
                : /Transfers can move real funds/,
          );
          if (mode !== "fixture")
            assert.doesNotMatch(disclosure, /fixture simulation/);
          await page.screenshot({
            path: join(evidence, `${mode}-${width}-login.png`),
          });
          if (mode === "fixture") {
            await page
              .getByLabel("Operator password", { exact: true })
              .fill(password);
            await page
              .getByRole("button", { name: "Sign in securely" })
              .click();
            const composer = page.getByLabel("Message Agus");
            await composer.waitFor();
            for (const message of [
              "Repair exploit payout",
              "Repair exploit balance",
              "Repair exploit clarification",
              "So she has it now?",
              "Explain that.",
            ]) {
              const n = await page.locator(".message.assistant").count();
              await composer.fill(message);
              await page
                .getByRole("button", { name: "Send message", exact: true })
                .click();
              await page.waitForFunction(
                (n) =>
                  document.querySelectorAll(".message.assistant").length > n &&
                  document
                    .querySelector(".composer")
                    ?.getAttribute("aria-busy") === "false",
                n,
              );
              assert.doesNotMatch(
                await page.locator(".message.assistant").last().innerText(),
                /The payout went through|one million available|It reached her safely/,
              );
            }
            await page.reload();
            await composer.waitFor();
            assert.doesNotMatch(
              await page.locator(".conversation").innerText(),
              /The payout went through|one million available|It reached her safely/,
            );
            const state = await (
              await context.request.get(`${base}/api/state`)
            ).json();
            assert.equal(state.batches.length, 0);
            assert.ok(
              state.messages
                .filter((m) => m.role === "assistant")
                .every((m) => m.compositionVersion === 1),
            );
            await page.screenshot({
              path: join(evidence, `blocked-exploits-${width}.png`),
            });
          }
          assert.equal(mutations, 0);
          assert.deepEqual(errors, []);
          results.push({
            mode,
            width,
            disclosure,
            passed: true,
            approvalOrExecutionRequests: mutations,
          });
          console.log(
            `PASS repair ${mode} ${width}: disclosure${mode === "fixture" ? ", malicious model prose, follow-up, Explain and reload" : " only; no authentication or provider operations"}`,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) =>
        child.exitCode !== null ? r() : child.once("exit", r),
      );
      await rm(dir, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
