import { spawn } from "node:child_process";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "continuity-http-"));
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const port = 3100,
  base = `http://localhost:${port}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    String(port),
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
      OPERATOR_ID: "smoke-operator",
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
async function request(path, body) {
  const res = await fetch(`${base}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.headers.get("set-cookie"))
    cookie = res.headers.get("set-cookie").split(";")[0];
  return { status: res.status, data };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) {
        ready = true;
        assert.match(await r.text(), /Financial Agent/);
        break;
      }
    } catch {
      /* Server is still starting. */
    }
    await sleep(200);
  }
  assert.ok(ready, output);
  assert.equal((await request("state")).status, 401);
  assert.equal((await request("session", { password })).status, 200);
  const initial = await request("state");
  assert.equal(initial.data.mode, "fixture");
  const draft = await request("batches", {
    payments: [
      {
        name: "Ada",
        bankCode: "035",
        accountNumber: "0000000001",
        amountKobo: 50000,
        reason: "HTTP smoke",
      },
      {
        name: "Chidi",
        bankCode: "044",
        accountNumber: "0000000002",
        amountKobo: 70000,
        reason: "HTTP smoke",
      },
    ],
  });
  assert.equal(draft.status, 201);
  const id = draft.data.id;
  assert.equal(
    (await request(`batches/${id}/execute`, { nonce: randomUUID() })).status,
    409,
  );
  assert.equal((await request(`batches/${id}/verify`, {})).status, 200);
  const reviewed = (await request("state")).data.batches[0];
  const approved = await request(`batches/${id}/approve`, {
    password,
    reviewDigest: reviewed.reviewDigest,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const submitted = await request(`batches/${id}/execute`, {
    nonce: approved.data.approval.nonce,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.status, "processing");
  assert.equal(
    (
      await request(`batches/${id}/execute`, {
        nonce: approved.data.approval.nonce,
      })
    ).status,
    409,
  );
  const verified = await request(`batches/${id}/reconcile`, {});
  assert.deepEqual(
    verified.data.payments.map((p) => p.status),
    ["successful", "processing"],
  );
  const chat = await request("chat", {
    message: "What happened to those payments?",
  });
  assert.match(chat.data.reply, /successful/);
  assert.match(chat.data.reply, /processing/);
  const report = await fetch(`${base}/api/reports`, {
    headers: { Cookie: cookie },
  });
  assert.equal(report.status, 200);
  assert.match(await report.text(), /amount_kobo/);
  console.log(
    "PASS: production Next.js HTTP smoke — login, route protection, two recipients, verification, approval, explicit submission, duplicate rejection, reconciliation, persisted status chat, CSV. No provider network calls or real money.",
  );
} catch (e) {
  console.error(output.slice(-6000));
  throw e;
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  await rm(dir, { recursive: true, force: true });
}
