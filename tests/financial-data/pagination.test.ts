import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_NOW,
  fixtureOtherPrincipal,
  createReadTools,
} from "../../src/lib/financial-data";
import { calcArgs, call, searchArgs, setup } from "./helpers";

describe("pagination, snapshot invalidation and bounded work", () => {
  it("binds opaque cursors to principal, exact filter and page size", async () => {
    const s = setup(),
      first = await s.tools.execute(
        s.ctx,
        call("search_transactions", { ...searchArgs, limit: 1 }),
      );
    const cursor = first.meta.nextCursor!;
    expect(cursor).toMatch(/^[\da-f-]{36}$/);
    for (const args of [
      { ...searchArgs, limit: 1, cursor: "tampered" },
      { ...searchArgs, limit: 1, cursor, query: "ada" },
      { ...searchArgs, limit: 2, cursor },
    ]) {
      expect(
        (await s.tools.execute(s.ctx, call("search_transactions", args))).error
          ?.code,
      ).toBe("CURSOR_INVALID");
    }
    // Even a second authorized principal cannot use another principal's cached snapshot.
    const other = await s.tools.execute(
      fixtureOtherPrincipal,
      call("search_transactions", {
        ...searchArgs,
        accountIds: ["tunde-current"],
        limit: 1,
        cursor,
      }),
    );
    expect(other.error?.code).toBe("CURSOR_INVALID");
    const replay = await s.tools.execute(
      s.ctx,
      call("search_transactions", { ...searchArgs, limit: 1, cursor }),
    );
    expect(replay.data?.matches[0].id).toBe("market-58");
  });
  it("expires snapshots exactly at 15 minutes and invalidates record changes", async () => {
    const s = setup(),
      first = await s.tools.execute(
        s.ctx,
        call("search_transactions", { ...searchArgs, limit: 1 }),
      );
    s.setNow("2026-10-17T10:15:00.000Z");
    expect(
      (
        await s.tools.execute(
          s.ctx,
          call("search_transactions", {
            ...searchArgs,
            limit: 1,
            cursor: first.meta.nextCursor,
          }),
        )
      ).error?.code,
    ).toBe("SNAPSHOT_EXPIRED");
    const changed = setup(),
      initial = await changed.tools.execute(
        changed.ctx,
        call("search_transactions", { ...searchArgs, limit: 1 }),
      );
    const t = (
      await changed.repository.listTransactions(changed.ctx, "amina-current")
    )[0];
    changed.repository.ingestTransactions([{ ...t, revision: 2 }]);
    expect(
      (
        await changed.tools.execute(
          changed.ctx,
          call("search_transactions", {
            ...searchArgs,
            limit: 1,
            cursor: initial.meta.nextCursor,
          }),
        )
      ).error?.code,
    ).toBe("SNAPSHOT_EXPIRED");
  });
  it("rechecks consent before cache reads", async () => {
    const s = setup(),
      initial = await s.tools.execute(
        s.ctx,
        call("search_transactions", { ...searchArgs, limit: 1 }),
      );
    await s.source.revokeConsent(s.ctx, "consent-amina");
    expect(
      (
        await s.tools.execute(
          s.ctx,
          call("search_transactions", {
            ...searchArgs,
            limit: 1,
            cursor: initial.meta.nextCursor,
          }),
        )
      ).error?.code,
    ).toBe("CONSENT_REVOKED");
  });
  it("deduplicates overlapping provider records by scoped provider ID without double-counting", async () => {
    const s = setup(undefined, (source) => ({
      ...source,
      async getTransactions(ctx, consentId, q) {
        const page = await source.getTransactions(ctx, consentId, {
          ...q,
          limit: 49,
        });
        return {
          ...page,
          items: page.items.length ? [...page.items, page.items[0]] : [],
        };
      },
    }));
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(r.data?.expenseKobo).toBe(1975151);
    expect(r.data?.includedCount).toBe(66);
  });
  it("rejects conflicting duplicate revisions on different pages", async () => {
    let stored: Awaited<
      ReturnType<ReturnType<typeof setup>["source"]["getTransactions"]>
    >["items"][0];
    const s = setup(undefined, (source) => ({
      ...source,
      async getTransactions(...args) {
        const page = await source.getTransactions(...args);
        if (!args[2].cursor) stored = page.items[0];
        else page.items.push({ ...stored, revision: stored.revision + 1 });
        return page;
      },
    }));
    expect(
      (await s.tools.execute(s.ctx, call("calculate_spending", calcArgs))).error
        ?.code,
    ).toBe("SNAPSHOT_EXPIRED");
  });
  it.each(["cycle", "empty", "duplicate-only"])(
    "fails closed on a provider %s page",
    async (kind) => {
      let first: Awaited<
        ReturnType<ReturnType<typeof setup>["source"]["getTransactions"]>
      >;
      const s = setup(undefined, (source) => ({
        ...source,
        async getTransactions(...args) {
          if (!first) first = await source.getTransactions(...args);
          if (kind === "empty")
            return { ...first, items: [], nextCursor: "no-progress" };
          return {
            ...first,
            nextCursor:
              kind === "cycle"
                ? "cycle"
                : `repeat-${args[2].cursor ?? "first"}`,
          };
        },
      }));
      const r = await s.tools.execute(
        s.ctx,
        call("calculate_spending", calcArgs),
      );
      expect(r.error?.code).toBe("CURSOR_INVALID");
      expect(r.data).toBeNull();
    },
  );
  it("rejects provider page over 50 records and foreign coverage account IDs", async () => {
    for (const kind of ["oversize", "foreign-coverage", "wrong-interval"]) {
      const s = setup(undefined, (source) => ({
        ...source,
        async getTransactions(...args) {
          const page = await source.getTransactions(...args);
          if (kind === "oversize") page.items.push(page.items[0]);
          if (kind === "foreign-coverage")
            page.coverage = {
              ...page.coverage,
              state: "partial",
              missingAccountIds: ["tunde-current"],
            };
          if (kind === "wrong-interval")
            page.coverage.from = "2026-01-01T00:00:00.000Z";
          return page;
        },
      }));
      expect(
        (await s.tools.execute(s.ctx, call("calculate_spending", calcArgs)))
          .error?.code,
      ).toBe("INVALID_PROVIDER_DATA");
    }
  });
  it("stops after 100 provider pages and never emits a partial total", async () => {
    let pages = 0;
    const s = setup(undefined, (source) => ({
      ...source,
      async getTransactions(...args) {
        const page = await source.getTransactions(args[0], args[1], {
          ...args[2],
          cursor: null,
        });
        pages++;
        return {
          ...page,
          items: [
            {
              ...page.items[0],
              id: `bounded-${pages}`,
              evidenceIds: [],
              provenance: {
                ...page.items[0].provenance,
                providerTransactionId: `bounded-provider-${pages}`,
              },
            },
          ],
          nextCursor: `page-${pages}`,
        };
      },
    }));
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(r.error?.code).toBe("LIMIT_EXCEEDED");
    expect(pages).toBe(100);
    expect(r.data).toBeNull();
  });
  it("enforces a call deadline and drops provider error text", async () => {
    const s = setup(
      undefined,
      (source) => ({ ...source, getTransactions: () => new Promise(() => {}) }),
      20,
    );
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(r.error?.code).toBe("TIMEOUT");
    expect(r.data).toBeNull();
  });
  it("keeps large search results under 16 KiB with explicit continuation", async () => {
    const s = setup((d) => {
      for (const t of d.transactions) {
        t.description = "x".repeat(500);
        t.counterparty.displayName = "y".repeat(100);
      }
    });
    const r = await s.tools.execute(
      s.ctx,
      call("search_transactions", { ...searchArgs, limit: 25 }),
    );
    expect(r.error).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(16384);
    expect(r.meta.truncated).toBe(true);
    expect(r.meta.nextCursor).toBeTruthy();
    expect(r.data?.hasMore).toBe(true);
  });
  it("returns LIMIT_EXCEEDED for an oversized calculation rather than truncating groups or totals", async () => {
    const s = setup((d) => {
      for (const [i, t] of d.transactions.entries())
        t.category = {
          value: `category-${i}-${"x".repeat(35)}`,
          source: "fixture",
        };
    });
    // More groups are needed than the fixed fixture provides; inject distinct valid records per page.
    let pageCount = 0;
    const provider = {
      ...s.source,
      async getTransactions(
        ...args: Parameters<typeof s.source.getTransactions>
      ) {
        const first = await s.source.getTransactions(args[0], args[1], {
          ...args[2],
          cursor: null,
        });
        pageCount++;
        const t = first.items.find(
          (v) => v.status === "posted" && v.direction === "debit",
        )!;
        const items = Array.from({ length: 50 }, (_, i) => ({
          ...t,
          id: `large-${pageCount}-${i}`,
          evidenceIds: [],
          category: {
            value: `group-${pageCount}-${i}-${"x".repeat(30)}`,
            source: "fixture" as const,
          },
          provenance: {
            ...t.provenance,
            providerTransactionId: `large-${pageCount}-${i}`,
          },
        }));
        return {
          ...first,
          items,
          nextCursor: pageCount < 4 ? `large-${pageCount}` : null,
        };
      },
    };
    const tools = createReadTools({
      repository: s.repository,
      sources: [provider],
      clock: () => FIXTURE_NOW,
    });
    const r = await tools.execute(
      s.ctx,
      call("calculate_spending", { ...calcArgs, groupBy: "category" }),
    );
    expect(r.error?.code).toBe("LIMIT_EXCEEDED");
    expect(r.data).toBeNull();
  });
  it("provider cursors also expire on revisions and reject filter changes", async () => {
    const s = setup(),
      q = {
        accountIds: searchArgs.accountIds,
        from: searchArgs.from,
        toExclusive: searchArgs.toExclusive,
        limit: 1,
        cursor: null,
      };
    const page = await s.source.getTransactions(s.ctx, "consent-amina", q);
    await expect(
      s.source.getTransactions(s.ctx, "consent-amina", {
        ...q,
        cursor: page.nextCursor,
        limit: 2,
      }),
    ).rejects.toThrow("CURSOR_INVALID");
    const t = (await s.repository.listTransactions(s.ctx, "amina-current"))[0];
    s.repository.ingestTransactions([{ ...t, revision: 2 }]);
    await expect(
      s.source.getTransactions(s.ctx, "consent-amina", {
        ...q,
        cursor: page.nextCursor,
      }),
    ).rejects.toThrow("SNAPSHOT_EXPIRED");
  });
});

it("bounds stalled repository authorization too", async () => {
  const s = setup();
  vi.spyOn(s.repository, "getAccount").mockImplementation(
    () => new Promise(() => {}),
  );
  const tools = createReadTools({
    repository: s.repository,
    sources: [s.source],
    clock: s.clock,
    timeoutMs: 20,
  });
  expect(
    (await tools.execute(s.ctx, call("calculate_spending", calcArgs))).error
      ?.code,
  ).toBe("TIMEOUT");
});

it("does not begin provider I/O after delayed authorization has exhausted the deadline", async () => {
  const s = setup();
  const read = s.repository.getAccount.bind(s.repository);
  vi.spyOn(s.repository, "getAccount").mockImplementation(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return read(...args);
  });
  const providerRead = vi.spyOn(s.provider, "getTransactions");
  const tools = createReadTools({
    repository: s.repository,
    sources: [s.provider],
    clock: s.clock,
    timeoutMs: 15,
  });
  expect(
    (await tools.execute(s.ctx, call("calculate_spending", calcArgs))).error
      ?.code,
  ).toBe("TIMEOUT");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(providerRead).not.toHaveBeenCalled();
});
