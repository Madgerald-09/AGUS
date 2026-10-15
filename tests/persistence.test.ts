import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
it("retains payment references and audit records across separate process restarts", async () => {
  const path = await mkdtemp(join(tmpdir(), "continuity-persistence-"));
  try {
    const env = {
      ...process.env,
      DATABASE_URL: `pglite://${path}`,
      PAYMENT_MODE: "fixture",
    };
    const run = (action: string) => {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "tests/persistence-worker.ts", action],
        { env, encoding: "utf8", timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim());
    };
    const written = run("write");
    const restored = run("read");
    expect(restored).toEqual(written);
    expect(restored.batches).toBe(1);
    expect(restored.auditCount).toBe(1);
    expect(restored.reference).toMatch(/^ha_/);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}, 60000);
