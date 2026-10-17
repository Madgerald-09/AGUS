import { describe, expect, it, vi } from "vitest";
import {
  AccountSummarySchema,
  FIXTURE_EXPECTED_OCTOBER,
  FIXTURE_NOW,
  MemoryFinancialRepository,
  createFixtureDataset,
  fixtureOtherPrincipal,
  toolResultSchema,
  type ToolData,
  type ToolResult,
} from "../../src/lib/financial-data";
import { calcArgs, call, searchArgs, setup } from "./helpers";

describe("P2 repair regressions", () => {
  it("exposes reversal links in credit-only search and detail, even outside the original's interval", async () => {
    const s = setup((d) => {
      const credit = d.transactions.find((t) => t.id === "return-oct")!;
      credit.description = "Synthetic account credit";
      credit.reference = "SYNTHETIC-CREDIT";
    });
    const found = await s.tools.execute(
      s.ctx,
      call("search_transactions", {
        ...searchArgs,
        from: "2026-10-04T00:00:00.000Z",
        toExclusive: "2026-10-05T00:00:00.000Z",
        direction: "credit",
      }),
    );
    expect(found.error).toBeNull();
    expect(found.data?.matches).toHaveLength(1);
    expect(found.data?.matches[0]).toMatchObject({
      id: "return-oct",
      status: "posted",
      direction: "credit",
      reversalOfId: "reversed-oct",
    });
    for (const [transactionId, reversalOfId] of [
      ["return-oct", "reversed-oct"],
      ["salary-oct", null],
      ["reversed-oct", null],
    ]) {
      const detail = await s.tools.execute(
        s.ctx,
        call("get_transaction", {
          accountId: "amina-current",
          transactionId: transactionId!,
        }),
      );
      expect(detail.error).toBeNull();
      expect(detail.data).toHaveProperty("reversalOfId", reversalOfId);
      expect(
        toolResultSchema("get_transaction").safeParse(detail).success,
      ).toBe(true);
      const { reversalOfId: _link, ...missingLink } = detail.data!;
      expect(
        toolResultSchema("get_transaction").safeParse({
          ...detail,
          data: missingLink,
        }).success,
      ).toBe(false);
    }
  });

  it.each(["get_transaction", "search_transactions"] as const)(
    "rejects an invalid reversal relationship in %s",
    async (name) => {
      const s = setup(undefined, (source) => ({
        ...source,
        async getTransaction(...args) {
          return {
            ...(await source.getTransaction(...args))!,
            reversalOfId: "salary-oct",
          };
        },
        async getTransactions(...args) {
          const page = await source.getTransactions(...args);
          return {
            ...page,
            items: page.items.map((t) =>
              t.id === "return-oct" ? { ...t, reversalOfId: "salary-oct" } : t,
            ),
          };
        },
      }));
      const result = await s.tools.dispatch(
        s.ctx,
        name === "get_transaction"
          ? call(name, {
              accountId: "amina-current",
              transactionId: "return-oct",
            })
          : call(name, searchArgs),
      );
      expect(result.error?.code).toBe("INVALID_PROVIDER_DATA");
      expect(result.data).toBeNull();
    },
  );

  it.each(["not_provided", "stale", null] as const)(
    "rejects undated numeric balances with reason %s at storage and tool boundaries",
    async (unavailableReason) => {
      const d = createFixtureDataset();
      const invalid = { ...d.summaries[0], asOf: null, unavailableReason };
      d.summaries[0] = invalid;
      expect(() => new MemoryFinancialRepository(d)).toThrow(
        "INVALID_PROVIDER_DATA",
      );
      const s = setup(undefined, (source) => ({
        ...source,
        async getAccountSummary(...args) {
          return {
            ...(await source.getAccountSummary(...args)),
            asOf: null,
            unavailableReason,
          };
        },
      }));
      const result = await s.tools.execute(
        s.ctx,
        call("get_account_summary", { accountIds: ["amina-current"] }),
      );
      expect(result.error?.code).toBe("INVALID_PROVIDER_DATA");
      expect(result.data).toBeNull();
    },
  );

  it.each([null, "invalid", "2026-02-30T00:00:00Z"])(
    "requires a valid timestamp for either numeric balance (%s)",
    (asOf) => {
      const summary = {
        accountId: "amina-current",
        currency: "NGN",
        asOf,
        simulated: true,
        unavailableReason: "not_provided",
      };
      for (const balances of [
        { availableKobo: 0, currentKobo: null },
        { availableKobo: null, currentKobo: -1 },
      ])
        expect(
          AccountSummarySchema.safeParse({ ...summary, ...balances }).success,
        ).toBe(false);
      expect(
        AccountSummarySchema.safeParse({
          ...summary,
          asOf: null,
          availableKobo: null,
          currentKobo: null,
        }).success,
      ).toBe(true);
    },
  );

  it("retains the exact 24-hour freshness boundary for dated partial balances", async () => {
    const s = setup((d) => {
      d.summaries[0].currentKobo = null;
      d.summaries[0].unavailableReason = "not_provided";
    });
    const read = () =>
      s.tools.execute(
        s.ctx,
        call("get_account_summary", { accountIds: ["amina-current"] }),
      );
    s.setNow("2026-10-18T10:00:00.000Z");
    expect((await read()).data?.accounts[0].availableKobo).toBe(12345678);
    s.setNow("2026-10-18T10:00:00.001Z");
    expect((await read()).data?.accounts[0]).toMatchObject({
      availableKobo: null,
      currentKobo: null,
      unavailableReason: "stale",
    });
  });

  it("rejects undated numeric balances returned directly by a repository-backed fixture adapter", async () => {
    const s = setup();
    vi.spyOn(s.repository, "getAccountSummary").mockResolvedValue({
      accountId: "amina-current",
      currency: "NGN",
      availableKobo: 0,
      currentKobo: null,
      asOf: null,
      simulated: true,
      unavailableReason: "not_provided",
    });
    await expect(
      s.source.getAccountSummary(s.ctx, "consent-amina", "amina-current"),
    ).rejects.toThrow("INVALID_PROVIDER_DATA");
  });

  it("pages through more than 100 search results without exhausting cursor capacity", async () => {
    const s = setup((d) => {
      const template = d.transactions[1];
      d.evidence = [];
      d.transactions = Array.from({ length: 125 }, (_, i) => ({
        ...template,
        id: `row-${i}`,
        evidenceIds: [],
        provenance: {
          ...template.provenance,
          providerTransactionId: `provider-row-${i}`,
        },
      }));
    });
    const providerRead = vi.spyOn(s.provider, "getTransactions");
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r: ToolResult<ToolData["search_transactions"]> =
        await s.tools.execute(
          s.ctx,
          call("search_transactions", { ...searchArgs, limit: 1, cursor }),
        );
      expect(r.error).toBeNull();
      ids.push(...r.data!.matches.map((t) => t.id));
      cursor = r.meta.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(125);
    expect(new Set(ids).size).toBe(125);
    expect(providerRead).toHaveBeenCalledTimes(3);
  });

  it("completes 205 repeated paginated calculations without retaining consumed provider cursors", async () => {
    const s = setup();
    for (let i = 0; i < 205; i++) {
      const r = await s.tools.execute(
        s.ctx,
        call("calculate_spending", calcArgs),
      );
      expect(r.error, `calculation ${i + 1}`).toBeNull();
      expect(r.data).toMatchObject(FIXTURE_EXPECTED_OCTOBER);
    }
  });

  it.each(["search", "provider"] as const)(
    "claims %s cursors once, rejects replay and concurrent reuse, and releases the final page",
    async (kind) => {
      const s = setup();
      const q = {
        accountIds: searchArgs.accountIds,
        from: searchArgs.from,
        toExclusive: searchArgs.toExclusive,
        limit: 50,
        cursor: null,
      };
      const read = async (cursor: string | null) => {
        if (kind === "provider") {
          const r = await s.source.getTransactions(s.ctx, "consent-amina", {
            ...q,
            cursor,
          });
          return r.nextCursor;
        }
        const r = await s.tools.execute(
          s.ctx,
          call("search_transactions", { ...searchArgs, limit: 25, cursor }),
        );
        if (r.error) throw new Error(r.error.code);
        return r.meta.nextCursor;
      };
      let cursor = await read(null);
      expect(cursor).toBeTruthy();
      const consumed = cursor;
      const simultaneous = await Promise.allSettled([
        read(cursor),
        read(cursor),
      ]);
      expect(simultaneous.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(simultaneous.filter((r) => r.status === "rejected")).toMatchObject(
        [{ reason: { message: "CURSOR_INVALID" } }],
      );
      cursor = simultaneous.find((r) => r.status === "fulfilled")!.value;
      await expect(read(consumed)).rejects.toThrow("CURSOR_INVALID");
      while (cursor) {
        const previous = cursor;
        cursor = await read(cursor);
        await expect(read(previous)).rejects.toThrow("CURSOR_INVALID");
      }
    },
  );

  it.each(["search", "provider"] as const)(
    "keeps the existing %s active-cursor capacity and reclaims space on completion and expiry",
    async (kind) => {
      const s = setup((d) => {
        const template = d.transactions[1];
        d.evidence = [];
        d.transactions = [
          template,
          {
            ...template,
            id: "second-row",
            provenance: {
              ...template.provenance,
              providerTransactionId: "second-provider-row",
            },
          },
        ];
      });
      const read = async (cursor: string | null) => {
        if (kind === "provider")
          return (
            await s.source.getTransactions(s.ctx, "consent-amina", {
              accountIds: searchArgs.accountIds,
              from: searchArgs.from,
              toExclusive: searchArgs.toExclusive,
              limit: 1,
              cursor,
            })
          ).nextCursor;
        const r = await s.tools.execute(
          s.ctx,
          call("search_transactions", { ...searchArgs, limit: 1, cursor }),
        );
        if (r.error) throw new Error(r.error.code);
        return r.meta.nextCursor;
      };
      let first: string | null = null;
      for (let i = 0; i < (kind === "search" ? 100 : 200); i++) {
        const cursor = await read(null);
        expect(cursor).toBeTruthy();
        first ??= cursor;
      }
      await expect(read(null)).rejects.toThrow("LIMIT_EXCEEDED");
      expect(await read(first)).toBeNull();
      expect(await read(null)).toBeTruthy();
      await expect(read(first)).rejects.toThrow("CURSOR_INVALID");
      s.setNow("2026-10-17T10:15:00.000Z");
      expect(await read(null)).toBeTruthy();
    },
  );

  it("retains provider principal, filter, expiry and revocation protections", async () => {
    const s = setup();
    const q = {
      accountIds: searchArgs.accountIds,
      from: searchArgs.from,
      toExclusive: searchArgs.toExclusive,
      limit: 1,
      cursor: null,
    };
    const first = await s.source.getTransactions(s.ctx, "consent-amina", q);
    const continued = { ...q, cursor: first.nextCursor };
    await expect(
      s.source.getTransactions(fixtureOtherPrincipal, "consent-tunde", {
        ...continued,
        accountIds: ["tunde-current"],
      }),
    ).rejects.toThrow("CURSOR_INVALID");
    await expect(
      s.source.getTransactions(s.ctx, "consent-amina", {
        ...continued,
        limit: 2,
      }),
    ).rejects.toThrow("CURSOR_INVALID");
    s.setNow("2026-10-17T10:15:00.000Z");
    await expect(
      s.source.getTransactions(s.ctx, "consent-amina", continued),
    ).rejects.toThrow("SNAPSHOT_EXPIRED");
    s.setNow(FIXTURE_NOW);
    const active = await s.source.getTransactions(s.ctx, "consent-amina", q);
    await s.source.revokeConsent(s.ctx, "consent-amina");
    await expect(
      s.source.getTransactions(s.ctx, "consent-amina", {
        ...q,
        cursor: active.nextCursor,
      }),
    ).rejects.toThrow("CONSENT_REVOKED");
  });
});
