import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_NOW,
  fixtureOtherPrincipal,
  fixturePrincipal,
  type ToolCall,
} from "../../src/lib/financial-data";
import { calcArgs, call, searchArgs, setup } from "./helpers";

const calls: ToolCall[] = [
  call("search_transactions", searchArgs),
  call("calculate_spending", calcArgs),
  call("get_transaction", {
    accountId: "amina-current",
    transactionId: "ada-okafor-oct",
  }),
  call("find_payment_evidence", {
    accountId: "amina-current",
    transactionId: "ada-okafor-oct",
  }),
  call("get_account_summary", { accountIds: ["amina-current"] }),
];
describe("ownership, exact scopes and consent lifecycle", () => {
  it.each(calls)(
    "denies another principal on $name before provider I/O",
    async (c) => {
      const reads = vi.fn();
      const s = setup(
        undefined,
        (source) =>
          new Proxy(
            { ...source },
            {
              get(target, key: keyof typeof source) {
                const value = target[key];
                if (typeof value !== "function") return value;
                return (...args: never[]) => {
                  reads();
                  return (value as (...args: never[]) => unknown)(...args);
                };
              },
            },
          ),
      );
      for (const ctx of [
        fixtureOtherPrincipal,
        { ...fixturePrincipal, tenantId: "other-tenant" },
      ]) {
        const r = await s.tools.dispatch(ctx, c);
        expect(r.error?.code).toBe(
          c.name === "get_transaction" || c.name === "find_payment_evidence"
            ? "NOT_FOUND"
            : "PERMISSION_DENIED",
        );
        expect(r.data).toBeNull();
        expect(r.meta.sources).toEqual([]);
      }
      expect(reads).not.toHaveBeenCalled();
    },
  );
  it("uses the same NOT_FOUND for absent and foreign individual IDs", async () => {
    const s = setup();
    for (const name of ["get_transaction", "find_payment_evidence"] as const) {
      const ownAbsent = await s.tools.execute(
        s.ctx,
        call(name, {
          accountId: "amina-current",
          transactionId: "does-not-exist",
        }),
      );
      const foreignId = await s.tools.execute(
        s.ctx,
        call(name, {
          accountId: "amina-current",
          transactionId: "tunde-private",
        }),
      );
      const foreignAccount = await s.tools.execute(
        s.ctx,
        call(name, {
          accountId: "tunde-current",
          transactionId: "tunde-private",
        }),
      );
      for (const r of [ownAbsent, foreignId, foreignAccount])
        expect(r.error?.code).toBe("NOT_FOUND");
    }
  });
  it("denies a whole multi-account read without returning the authorized portion", async () => {
    let calls = 0;
    const s = setup(undefined, (source) => ({
      ...source,
      async getAccountSummary(...args) {
        calls++;
        return source.getAccountSummary(...args);
      },
    }));
    const r = await s.tools.execute(
      s.ctx,
      call("get_account_summary", {
        accountIds: ["amina-current", "tunde-current"],
      }),
    );
    expect(r.error?.code).toBe("PERMISSION_DENIED");
    expect(calls).toBe(0);
  });
  it.each(calls)(
    "checks expiration against server clock on $name",
    async (c) => {
      const s = setup((d) => {
        d.consents[0].expiresAt = FIXTURE_NOW;
      });
      const spy = vi.spyOn(s.provider, "getTransactions");
      const r = await s.tools.dispatch(
        { ...s.ctx, now: "2025-01-01T00:00:00.000Z" },
        c,
      );
      expect(r.error?.code).toBe("CONSENT_EXPIRED");
      expect(spy).not.toHaveBeenCalled();
    },
  );
  it.each(calls)("rejects revoked consent on $name", async (c) => {
    const s = setup();
    await s.source.revokeConsent(s.ctx, "consent-amina");
    expect((await s.tools.dispatch(s.ctx, c)).error?.code).toBe(
      "CONSENT_REVOKED",
    );
  });
  it.each(calls)("requires explicit scope on $name", async (c) => {
    const s = setup((d) => {
      d.consents[0].scopes =
        c.name === "get_account_summary"
          ? ["transactions:read"]
          : ["accounts:read"];
    });
    expect((await s.tools.dispatch(s.ctx, c)).error?.code).toBe(
      "PERMISSION_DENIED",
    );
  });
  it("requires both transaction and evidence scope without implication", async () => {
    for (const scopes of [["transactions:read"], ["evidence:read"]] as const) {
      const s = setup((d) => {
        d.consents[0].scopes = [...scopes];
      });
      expect(
        (
          await s.tools.execute(
            s.ctx,
            call("find_payment_evidence", {
              accountId: "amina-current",
              transactionId: "ada-okafor-oct",
            }),
          )
        ).error?.code,
      ).toBe("PERMISSION_DENIED");
    }
  });
  it.each(calls)(
    "suppresses results if consent is revoked during $name I/O",
    async (c) => {
      const s = setup(undefined, (source, repository) => {
        const revoke = () =>
          repository.revokeConsent(
            fixturePrincipal,
            "consent-amina",
            FIXTURE_NOW,
          );
        return {
          ...source,
          async getTransactions(...args) {
            const r = await source.getTransactions(...args);
            await revoke();
            return r;
          },
          async getTransaction(...args) {
            const r = await source.getTransaction(...args);
            await revoke();
            return r;
          },
          async getAccountSummary(...args) {
            const r = await source.getAccountSummary(...args);
            await revoke();
            return r;
          },
        };
      });
      const r = await s.tools.dispatch(s.ctx, c);
      expect(r.error?.code).toBe("CONSENT_REVOKED");
      expect(r.data).toBeNull();
    },
  );
  it("suppresses results if consent expires during I/O", async () => {
    const s = setup(undefined, (source) => ({
      ...source,
      async getTransaction(...args) {
        const t = await source.getTransaction(...args);
        s.setNow("2027-01-01T00:00:00.000Z");
        return t;
      },
    }));
    expect(
      (
        await s.tools.execute(
          s.ctx,
          call("get_transaction", {
            accountId: "amina-current",
            transactionId: "ada-okafor-oct",
          }),
        )
      ).error?.code,
    ).toBe("CONSENT_EXPIRED");
  });
  it("checks missing consent and binding mismatches before I/O", async () => {
    const s = setup();
    vi.spyOn(s.repository, "getConsent").mockResolvedValueOnce(null);
    expect((await s.tools.dispatch(s.ctx, calls[0])).error?.code).toBe(
      "CONSENT_REQUIRED",
    );
    const original = await s.repository.getConsent(s.ctx, "consent-amina");
    vi.spyOn(s.repository, "getConsent").mockResolvedValue({
      ...original!,
      accountIds: ["amina-savings"],
    });
    expect((await s.tools.dispatch(s.ctx, calls[0])).error?.code).toBe(
      "PERMISSION_DENIED",
    );
  });
  it("fixture adapter independently denies every operation to foreign users", async () => {
    const s = setup();
    const operations = [
      () => s.source.listAccounts(fixtureOtherPrincipal, "consent-amina"),
      () =>
        s.source.getTransactions(fixtureOtherPrincipal, "consent-amina", {
          accountIds: searchArgs.accountIds,
          from: searchArgs.from,
          toExclusive: searchArgs.toExclusive,
          cursor: null,
          limit: 50,
        }),
      () =>
        s.source.getTransaction(
          fixtureOtherPrincipal,
          "consent-amina",
          "amina-current",
          "ada-okafor-oct",
        ),
      () =>
        s.source.getEvidence(
          fixtureOtherPrincipal,
          "consent-amina",
          "amina-current",
          "ada-okafor-oct",
        ),
      () =>
        s.source.getAccountSummary(
          fixtureOtherPrincipal,
          "consent-amina",
          "amina-current",
        ),
      () => s.source.revokeConsent(fixtureOtherPrincipal, "consent-amina"),
    ];
    for (const op of operations) await expect(op()).rejects.toThrow();
    expect((await s.repository.getConsent(s.ctx, "consent-amina"))?.state).toBe(
      "active",
    );
  });
  it("repository reads never cross account, owner or tenant boundaries", async () => {
    const s = setup();
    expect(
      await s.repository.getTransaction(
        s.ctx,
        "amina-savings",
        "ada-okafor-oct",
      ),
    ).toBeNull();
    expect(
      await s.repository.getEvidence(
        fixtureOtherPrincipal,
        "amina-current",
        "ada-okafor-oct",
      ),
    ).toEqual([]);
    expect(
      await s.repository.getAccountSummary(
        fixtureOtherPrincipal,
        "amina-current",
      ),
    ).toBeNull();
    expect(
      await s.repository.listAccounts(fixtureOtherPrincipal, "consent-amina"),
    ).toEqual([]);
    expect(
      await s.repository.listTransactions(
        fixtureOtherPrincipal,
        "amina-current",
      ),
    ).toEqual([]);
  });
});
