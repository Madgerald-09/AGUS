import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const app = resolve(process.env.AGUS_APP_DIR || "/workspace/agus-clearance");
const root = resolve(import.meta.dirname, "..");
const dest = join(root, "public/captures");
const raw = join(root, "raw");
await mkdir(dest, { recursive: true });
await mkdir(raw, { recursive: true });
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: app,
  encoding: "utf8",
}).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: app,
  encoding: "utf8",
}).trim();
assert.equal(tree, "893b04995a77bc664bb9f5b20288e5be1b691bd5");
const dir = await mkdtemp(join(tmpdir(), "agus-film-db-"));
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const base = "http://localhost:3120";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3120",
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: app,
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      PAYMENT_MODE: "fixture",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      PAYSTACK_SECRET_KEY: "",
      OPERATOR_ID: "demo-film-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      APP_ORIGIN: base,
      NEXT_TELEMETRY_DISABLED: "1",
      LIVE_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_WEBHOOK_VALIDATED: "false",
      LIVE_RECONCILIATION_VALIDATED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
let browser, context;
const shots = [];
const errors = [];
let approval = 0,
  execution = 0,
  external = 0;
let t0;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await pause(200);
    if (i === 99) throw Error(output);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    recordVideo: { dir: raw, size: { width: 1280, height: 800 } },
  });
  await context.route("**/*", (r) => {
    if (r.request().url().startsWith(base)) return r.continue();
    external++;
    return r.abort();
  });
  const page = await context.newPage();
  t0 = Date.now();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/approve")) approval++;
    if (r.url().endsWith("/execute")) execution++;
  });
  async function shot(name, action, check) {
    const start = (Date.now() - t0) / 1000;
    await pause(600);
    await action();
    await pause(1600);
    if (check) await check();
    await page.screenshot({ path: join(dest, `${name}.png`) });
    const end = (Date.now() - t0) / 1000;
    shots.push({ name, start, end, duration: end - start });
    console.log(`Captured ${name}`);
  }
  async function send(text) {
    const n = await page.locator(".message.assistant").count();
    const composer = page.getByLabel("Message Agus");
    await composer.click();
    await composer.pressSequentially(text, { delay: 35 });
    await pause(300);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll(".message.assistant").length > n &&
        document.querySelector(".composer")?.getAttribute("aria-busy") ===
          "false",
      n,
    );
  }
  async function nav(tab) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: tab, exact: true })
      .click();
  }
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await shot(
    "01-login",
    async () => {
      await pause(1000);
    },
    async () =>
      assert.match(
        await page.locator(".demo-notice").innerText(),
        /local fixture simulation/,
      ),
  );
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByLabel("Message Agus").waitFor();
  await shot(
    "02-welcome",
    async () => pause(1000),
    async () =>
      assert.match(await page.locator(".model-status").innerText(), /no AI/),
  );
  await shot(
    "03-food",
    () => send("How much did I spend on food?"),
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /fictional demonstration ledger/,
      ),
  );
  await shot(
    "04-totals",
    () => send("Show my income and expenses"),
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /seeded transactions/,
      ),
  );
  await shot(
    "05-explain",
    () => send("Explain that."),
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /fictional sample ledger/,
      ),
  );
  await shot(
    "06-boundary",
    () => send("What is my bank balance?"),
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /don’t have access to your bank balance/,
      ),
  );
  await shot(
    "07-partial",
    async () => {
      await send("Prepare 500 to Ada at Wema");
      await page.locator(".proposal-summary > summary").last().click();
      await page
        .getByRole("region", { name: "Payment proposal", exact: true })
        .waitFor();
    },
    async () => {
      const p = page.getByRole("region", {
        name: "Payment proposal",
        exact: true,
      });
      assert.equal(
        await p.getByLabel("Account number", { exact: true }).inputValue(),
        "",
      );
      assert.equal(approval, 0);
      assert.equal(execution, 0);
    },
  );
  const proposal = page.getByRole("region", {
    name: "Payment proposal",
    exact: true,
  });
  await shot("08-details", async () => {
    await proposal
      .getByLabel("Fictional recipient 1")
      .selectOption("0000000001");
    await pause(900);
    await proposal
      .getByRole("button", { name: "Add recipient", exact: true })
      .click();
    await proposal
      .getByLabel("Fictional recipient 2")
      .selectOption("0000000002");
    await pause(900);
    await proposal
      .getByLabel("Amount (NGN)", { exact: true })
      .nth(1)
      .fill("700");
    await proposal.getByLabel("Description", { exact: true }).nth(1).click();
    await pause(800);
    await proposal
      .getByLabel("Amount (NGN)", { exact: true })
      .nth(1)
      .scrollIntoViewIfNeeded();
  });
  await shot(
    "09-draft",
    async () => {
      await proposal
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await proposal.waitFor({ state: "detached" });
      await page
        .locator(".compact-payment:not(.proposal-summary) > summary")
        .last()
        .click();
      await page.locator(".batch-card").last().waitFor();
      await page
        .locator(".batch-card")
        .last()
        .evaluate((e) =>
          e.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
    },
    async () => {
      assert.equal(approval, 0);
      assert.equal(execution, 0);
    },
  );
  const card = page.locator(".batch-card").last();
  await shot(
    "10-verify",
    async () => {
      await card
        .getByRole("button", { name: "Verify beneficiaries", exact: true })
        .click();
      await card.getByRole("checkbox").waitFor();
      await card.evaluate((e) =>
        e.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    },
    async () => assert.equal(execution, 0),
  );
  await shot(
    "11-approval",
    async () => {
      await card.getByRole("checkbox").check();
      await card
        .getByLabel("Password to approve reviewed batch")
        .fill(password);
      await pause(1500);
      await card
        .getByRole("button", { name: "Approve reviewed batch", exact: true })
        .click();
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .waitFor();
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await pause(1000);
    },
    async () => {
      assert.equal(approval, 1);
      assert.equal(execution, 0);
    },
  );
  await shot(
    "12-outcomes",
    async () => {
      await card
        .getByRole("button", {
          name: "Submit simulated transfers",
          exact: true,
        })
        .click();
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .waitFor();
      await pause(700);
      await card
        .getByRole("button", { name: "Check provider", exact: true })
        .click();
      await card.locator(".payment-row .badge.successful").waitFor();
      await card.locator(".payment-row .badge.processing").waitFor();
      await card.evaluate((e) =>
        e.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    },
    async () => assert.equal(execution, 1),
  );
  await page
    .locator(".compact-payment:not(.proposal-summary) > summary")
    .last()
    .click();
  await shot(
    "13-pending",
    () => send("What payments are still pending?"),
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /remain unresolved/,
      ),
  );
  await shot(
    "14-persistence",
    async () => {
      await page.reload();
      await page.getByLabel("Message Agus").waitFor();
      await page
        .locator(".message.assistant")
        .last()
        .evaluate((e) =>
          e.scrollIntoView({ block: "center", behavior: "smooth" }),
        );
    },
    async () =>
      assert.match(
        await page.locator(".message.assistant").last().innerText(),
        /remain unresolved/,
      ),
  );
  await shot(
    "15-activity",
    async () => nav("Activity"),
    async () =>
      assert.equal(
        await page
          .getByRole("cell", { name: "Simulation", exact: true })
          .count(),
        2,
      ),
  );
  await shot(
    "16-insights",
    async () => nav("Insights"),
    async () =>
      await page.getByText("Demonstration ledger", { exact: true }).waitFor(),
  );
  await page.getByRole("button", { name: "Back to conversation" }).click();
  const s = await (await context.request.get(`${base}/api/state`)).json();
  assert.equal(s.mode, "fixture");
  assert.equal(s.aiEnabled, false);
  assert.equal(s.batches.length, 1);
  assert.deepEqual(
    s.batches[0].payments.map((p) => p.status),
    ["successful", "processing"],
  );
  assert.ok(s.batches[0].approval.consumedAt);
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  const evidence = {
    sourceCommit: source,
    sourceTree: tree,
    mode: "fixture",
    aiProvider: "none",
    genuineModelCalls: 0,
    externalBrowserRequests: external,
    approvalRequests: approval,
    executionRequests: execution,
    finalStatuses: s.batches[0].payments.map((p) => p.status),
    browserErrors: errors,
    capturedAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    shots,
  };
  const videoPath = await page.video().path();
  await context.close();
  context = null;
  await copyFile(videoPath, join(raw, "master.webm"));
  for (const shot of shots) {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(shot.start),
        "-i",
        join(raw, "master.webm"),
        "-t",
        String(shot.duration),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "24",
        join(dest, `${shot.name}.mp4`),
      ],
      { stdio: "ignore" },
    );
  }
  await writeFile(
    join(dest, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    "PASS: all captures asserted; no external provider, fixture only.",
  );
} finally {
  await context?.close();
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once("exit", r),
  );
  await rm(dir, { recursive: true, force: true });
}
