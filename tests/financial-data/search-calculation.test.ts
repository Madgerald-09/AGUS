import { describe, expect, it } from "vitest";
import {
  FIXTURE_EXPECTED_OCTOBER,
  createFixtureDataset,
  lagosDateInterval,
  type ToolResult,
  type ToolData,
} from "../../src/lib/financial-data";
import { calcArgs, call, filter, searchArgs, setup } from "./helpers";

describe("deterministic searches and integer-kobo calculations", () => {
  it("keeps similar recipients ambiguous even with one displayed candidate", async () => {
    const s = setup(),
      r = await s.tools.execute(
        s.ctx,
        call("search_transactions", { ...searchArgs, query: "Ada", limit: 1 }),
      );
    expect(r.data?.selection).toBe("ambiguous");
    expect(r.data?.matchCount).toBe(2);
    expect(r.data?.matches[0].id).toBe("ada-obi-oct");
    expect(r.meta.nextCursor).toBeTruthy();
    expect(r.meta.warnings).toContain("SELECTION_REQUIRED");
  });
  it("returns zero, single and exact ranked results without proof-of-payment claims", async () => {
    const s = setup();
    const none = await s.tools.execute(
      s.ctx,
      call("search_transactions", { ...searchArgs, query: "missing name" }),
    );
    expect(none.data?.selection).toBe("none");
    expect(none.meta.warnings).toContain("REFINE_SEARCH_NOT_PROOF_OF_ABSENCE");
    const exact = await s.tools.execute(
      s.ctx,
      call("search_transactions", {
        ...searchArgs,
        query: "SYNTHETIC-ada-okafor-oct",
      }),
    );
    expect(exact.data?.selection).toBe("single_candidate");
    expect(exact.data?.matches[0].rankReason).toBe("exact_reference");
    const named = await s.tools.execute(
      s.ctx,
      call("search_transactions", {
        ...searchArgs,
        query: "Ada Okafor (fictional)",
      }),
    );
    expect(named.data?.matches[0].rankReason).toBe("exact_counterparty");
  });
  it("finds past months and years only within explicit intervals", async () => {
    const s = setup();
    for (const [from, to, expected] of [
      ["2026-09-01", "2026-10-01", "ada-september"],
      ["2025-10-01", "2025-11-01", "ada-previous-year"],
    ]) {
      const r = await s.tools.execute(
        s.ctx,
        call("search_transactions", {
          ...searchArgs,
          ...lagosDateInterval(from, to),
          query: "Ada",
        }),
      );
      expect(r.data?.matches.map((m) => m.id)).toEqual([expected]);
    }
  });
  it("applies exact inclusive amounts and AND-token matching after Unicode normalization", async () => {
    const s = setup((d) => {
      d.transactions[0].description = "Café ＡＤＡ services";
    });
    const r = await s.tools.execute(
      s.ctx,
      call("search_transactions", {
        ...searchArgs,
        query: "Ｃａｆé ada",
        amountKobo: { min: 500000, max: 500000 },
      }),
    );
    expect(r.data?.matches.map((t) => t.id)).toEqual(["ada-okafor-oct"]);
    const unmatched = await s.tools.execute(
      s.ctx,
      call("search_transactions", { ...searchArgs, query: "ada nonexistent" }),
    );
    expect(unmatched.data?.matches).toEqual([]);
  });
  it("uses Lagos half-open midnight boundaries and rejects invalid calendar dates", async () => {
    expect(filter.from).toBe("2026-09-30T23:00:00.000Z");
    expect(() => lagosDateInterval("2026-02-30", "2026-03-02")).toThrow();
    const s = setup(),
      r = await s.tools.execute(
        s.ctx,
        call("search_transactions", {
          ...searchArgs,
          ...lagosDateInterval("2026-10-01", "2026-10-02"),
        }),
      );
    expect(r.data?.matches.map((t) => t.id).sort()).toEqual([
      "october-midnight",
      "salary-oct",
    ]);
  });
  it("matches hand-calculated totals across provider pages, excluding all uncertain and reversal records", async () => {
    let pages = 0;
    const s = setup(undefined, (source) => ({
      ...source,
      async getTransactions(...args) {
        pages++;
        return source.getTransactions(...args);
      },
    }));
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(pages).toBe(2);
    // 500000 + 750000 + 125050 + 1 + 100 + (60 × 10000) = 1975151.
    // Salary 25000000 - expenses 1975151 = net 23024849, 66 included records.
    expect(r.data).toMatchObject(FIXTURE_EXPECTED_OCTOBER);
    expect(r.data?.excluded).toEqual({
      pending: 1,
      failed: 1,
      reversed: 1,
      unknown: 1,
      reversal: 1,
      undated: 1,
    });
    expect(r.outcome).toBe("partial");
    expect(r.meta.warnings).toContain("AVAILABLE_RECORDS_ONLY");
  });
  it("calculates income and filtered expenses exactly without implying unfiltered cashflow", async () => {
    const s = setup();
    const credits = await s.tools.execute(
      s.ctx,
      call("calculate_spending", { ...calcArgs, direction: "credit" }),
    );
    expect(credits.data).toMatchObject({
      incomeKobo: 25000000,
      expenseKobo: 0,
      netKobo: 25000000,
      appliedFilters: { direction: "credit" },
    });
    const food = await s.tools.execute(
      s.ctx,
      call("calculate_spending", { ...calcArgs, category: "food" }),
    );
    expect(food.data?.expenseKobo).toBe(125050);
  });
  it("groups months and Monday weeks in Lagos, applying filters before grouping", async () => {
    const s = setup();
    const month = await s.tools.execute(
      s.ctx,
      call("calculate_spending", { ...calcArgs, groupBy: "month" }),
    );
    expect(month.data?.groups).toEqual([
      expect.objectContaining({ key: "2026-10", expenseKobo: 1975151 }),
    ]);
    const week = await s.tools.execute(
      s.ctx,
      call("calculate_spending", {
        ...calcArgs,
        groupBy: "week",
        ...lagosDateInterval("2026-10-01", "2026-10-02"),
      }),
    );
    expect(week.data?.groups).toEqual([
      expect.objectContaining({ key: "2026-09-28", expenseKobo: 100 }),
    ]);
    const category = await s.tools.execute(
      s.ctx,
      call("calculate_spending", {
        ...calcArgs,
        groupBy: "category",
        category: "food",
      }),
    );
    expect(category.data?.groups).toEqual([
      expect.objectContaining({ key: "food", includedCount: 1 }),
    ]);
  });
  it("searches non-posted statuses but rejects them for authoritative totals", async () => {
    const s = setup();
    const r = await s.tools.execute(
      s.ctx,
      call("search_transactions", {
        ...searchArgs,
        statuses: ["pending", "failed", "unknown", "reversed"],
      }),
    );
    expect(r.data?.matches).toHaveLength(4);
    for (const status of [
      "pending",
      "failed",
      "unknown",
      "reversed",
    ] as const) {
      expect(
        (
          await s.tools.dispatch(
            s.ctx,
            call("calculate_spending", { ...calcArgs, statuses: [status] }),
          )
        ).error?.code,
      ).toBe("INVALID_ARGUMENT");
    }
  });
  it("returns a complete empty zero only when coverage is known", async () => {
    const s = setup((d) => {
      d.transactions = d.transactions.filter(
        (t) => t.accountId !== "amina-current",
      );
      d.evidence = [];
    });
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(r.outcome).toBe("ok");
    expect(r.data).toMatchObject({
      expenseKobo: 0,
      incomeKobo: 0,
      includedCount: 0,
    });
    const unknown = await s.tools.execute(
      s.ctx,
      call("calculate_spending", {
        ...calcArgs,
        accountIds: ["amina-savings"],
      }),
    );
    expect(unknown.error?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(unknown.data).toBeNull();
  });
  it("fails safely on total overflow without exposing partial arithmetic", async () => {
    const s = setup((d) => {
      d.transactions[0].amountKobo = Number.MAX_SAFE_INTEGER;
    });
    const r = await s.tools.execute(
      s.ctx,
      call("calculate_spending", calcArgs),
    );
    expect(r.error?.code).toBe("ARITHMETIC_OVERFLOW");
    expect(r.data).toBeNull();
  });
  it("has deterministic ordering and no duplicates over every search page", async () => {
    const s = setup();
    let cursor: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r: ToolResult<ToolData["search_transactions"]> =
        await s.tools.execute(
          s.ctx,
          call("search_transactions", { ...searchArgs, limit: 9, cursor }),
        );
      expect(r.error).toBeNull();
      ids.push(...r.data!.matches.map((t) => t.id));
      cursor = r.meta.nextCursor;
      if (!cursor) break;
    }
    expect(ids).toHaveLength(71);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(["market-59", "market-58"]);
  });
  it("keeps same-name, same-amount, same-date distinct provider IDs", async () => {
    const s = setup((d) => {
      const t = structuredClone(d.transactions[0]);
      t.id = "distinct";
      t.evidenceIds = [];
      t.provenance.providerTransactionId = "distinct-provider";
      d.transactions.push(t);
    });
    const r = await s.tools.execute(
      s.ctx,
      call("search_transactions", { ...searchArgs, query: "Ada Okafor" }),
    );
    expect(r.data?.matches.map((t) => t.id)).toEqual([
      "ada-okafor-oct",
      "distinct",
    ]);
  });
  it("contains no real customer data or payment module dependency", () => {
    expect(
      createFixtureDataset().transactions.every(
        (t) => t.simulated && t.provenance.provider === "fixture",
      ),
    ).toBe(true);
  });
});
