import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

it.each(["reversal-write", "reversal-interrupt", "otp-write", "otp-interrupt"])(
  "recovers durable financial state across separate processes: %s",
  async (action) => {
    const path = await mkdtemp(join(tmpdir(), "financial-safety-restart-"));
    const log = join(path, "provider-calls.log");
    try {
      const env = {
        ...process.env,
        DATABASE_URL: `pglite://${join(path, "db")}`,
        PAYMENT_MODE: "test",
        PAYSTACK_SECRET_KEY: "sk_test_fictional",
        SAFETY_CALL_LOG: log,
      };
      const run = (phase: string) => {
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", "tests/safety-restart-worker.ts", phase],
          { env, encoding: "utf8", timeout: 30000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
      };
      run(action);
      const before = await readFile(log, "utf8");
      run(action.startsWith("otp") ? "otp-read" : "reversal-read");
      run(action.startsWith("otp") ? "otp-inspect" : "reversal-inspect");
      expect(await readFile(log, "utf8")).toBe(before);
      expect(before.split("\n").filter((s) => s === "submit")).toHaveLength(1);
      expect(before.split("\n").filter((s) => s === "finalize")).toHaveLength(
        action.startsWith("otp") ? 1 : 0,
      );
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  },
  60000,
);
