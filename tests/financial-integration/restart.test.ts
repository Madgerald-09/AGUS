import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

it("retains sessions, principal mapping, data, context and revocation across process restarts; loses cursors safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agus-financial-restart-"));
  try {
    const env = {
      ...process.env,
      DATABASE_URL: `pglite://${join(dir, "db")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      OPERATOR_ID: "restart-operator",
    };
    const run = (action: string) => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/financial-integration/restart-worker.ts",
          action,
          join(dir, "cursor.json"),
        ],
        { env, encoding: "utf8", timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim());
    };
    const seeded = run("seed");
    expect(seeded.consentState).toBe("active");
    expect(seeded.expenseKobo).toBe(1975151);
    expect(seeded.counts).toEqual({ transactions: 77, seeds: 1 });
    const restored = run("read");
    expect(restored.contextOutcome).toEqual(seeded.contextOutcome);
    expect(restored.actorId).toBe("fictional-amina");
    expect(restored.continuationError).toBe("CURSOR_INVALID");
    expect(restored.counts).toEqual(seeded.counts);
    expect(restored.expenseKobo).toBe(1975151);
    const revoked = run("revoke");
    expect(revoked.consentState).toBe("revoked");
    expect(revoked.contextOutcome).toEqual({ error: "CONSENT_REVOKED" });
    const again = run("read");
    expect(again.consentState).toBe("revoked");
    expect(again.expenseKobo).toBeNull();
    expect(again.contextOutcome).toEqual({ error: "CONSENT_REVOKED" });
    expect(again.counts).toEqual(seeded.counts);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120000);
