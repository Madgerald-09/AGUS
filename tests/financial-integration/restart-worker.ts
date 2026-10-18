import { writeFileSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, sessions } from "../../src/lib/db";
import { hash } from "../../src/lib/auth";
import { financialContext } from "../../src/lib/financial-integration/service";
import {
  createDurableRepository,
  initializeFinancialStorage,
} from "../../src/lib/financial-integration/storage";
import { createContextStore } from "../../src/lib/financial-integration/context-store";
import { createReadTools } from "../../src/lib/financial-data/tools";
import {
  createFixtureDataSource,
  FIXTURE_NOW,
} from "../../src/lib/financial-data/fixture";

const [action, cursorPath] = process.argv.slice(2);
await initializeFinancialStorage();
const d = await db();
if (action === "seed")
  await d.insert(sessions).values({
    tokenHash: hash("fixture-only-restart-session"),
    operatorId: "restart-operator",
    expiresAt: new Date(Date.now() + 3600000),
  });
const ctx = await financialContext(
  new Request("http://localhost:3000/api/financial-agent", {
    headers: { cookie: "ha_session=fixture-only-restart-session" },
  }),
);
const repository = createDurableRepository();
const clock = () => FIXTURE_NOW;
const context = createContextStore(ctx, repository, clock);
const tools = createReadTools({
  repository,
  sources: [createFixtureDataSource({ repository, clock })],
  clock,
});
const call = {
  protocolVersion: 1,
  callId: "restart",
  name: "search_transactions",
  args: {
    accountIds: ["amina-current"],
    from: "2026-09-30T23:00:00Z",
    toExclusive: "2026-10-31T23:00:00Z",
    query: "",
    limit: 1,
    cursor: null as string | null,
  },
};
if (action === "seed") {
  await context.save("restart-conversation", 0, {
    schemaVersion: 1,
    accountIds: ["amina-current"],
    selected: null,
    candidateSet: {
      resultId: "restart-result",
      filters: {
        accountIds: ["amina-current"],
        from: call.args.from,
        toExclusive: call.args.toExclusive,
      },
      query: "Ada",
      candidates: [
        {
          accountId: "amina-current",
          transactionId: "ada-okafor-oct",
          revision: 1,
        },
      ],
    },
    messages: [{ role: "user", text: "October purchases" }],
  });
  const result = await tools.dispatch(ctx, call);
  writeFileSync(
    cursorPath,
    JSON.stringify({ cursor: result.meta.nextCursor }),
    { mode: 0o600 },
  );
}
const saved = JSON.parse(readFileSync(cursorPath, "utf8")) as {
  cursor: string;
};
if (action === "revoke")
  await repository.revokeConsent(ctx, "consent-amina", FIXTURE_NOW);
const consent = await repository.getConsent(ctx, "consent-amina");
const continuation = await tools.dispatch(ctx, {
  ...call,
  args: { ...call.args, cursor: saved.cursor },
});
let contextOutcome: unknown;
try {
  contextOutcome = await context.load("restart-conversation");
} catch (error) {
  contextOutcome = { error: (error as { code: string }).code };
}
const counts = await d.execute(
  sql`SELECT (SELECT count(*)::integer FROM fm_transactions) AS transactions, (SELECT count(*)::integer FROM fm_seed) AS seeds`,
);
const total = await tools.dispatch(ctx, {
  protocolVersion: 1,
  callId: "total",
  name: "calculate_spending",
  args: {
    accountIds: ["amina-current"],
    from: call.args.from,
    toExclusive: call.args.toExclusive,
    groupBy: "none",
  },
});
writeFileSync(
  1,
  JSON.stringify({
    actorId: ctx.actorId,
    contextOutcome,
    consentState: consent?.state,
    continuationError: continuation.error?.code ?? null,
    counts: counts.rows[0],
    expenseKobo:
      (total.data as { expenseKobo?: number } | null)?.expenseKobo ?? null,
  }),
);
process.exit(0);
