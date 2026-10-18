import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { operator } from "../auth";
import { config } from "../config";
import { db } from "../db";
import { AppError } from "../domain";
import {
  createFixtureDataSource,
  FIXTURE_LABEL,
} from "../financial-data/fixture";
import { createReadTools } from "../financial-data/tools";
import type {
  PermissionContext,
  ReadToolDispatcher,
} from "../financial-data/contracts";
import { createDurableRepository, initializeFinancialStorage } from "./storage";

export const simulation = Object.freeze({
  mode: "fixture",
  simulated: true,
  label: FIXTURE_LABEL,
});
export function requireFinancialDemo() {
  if (
    process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
    config().mode !== "fixture"
  )
    throw new AppError("Financial fixture integration unavailable", 503);
}
export async function financialContext(
  req: Request,
): Promise<PermissionContext> {
  const authenticatedOperator = await operator(req);
  requireFinancialDemo();
  await initializeFinancialStorage();
  const d = await db();
  // Only the configured, session-verified operator receives the default demo binding.
  // A persisted binding is never overwritten when the process restarts.
  await d.execute(
    sql`INSERT INTO fm_principals VALUES (${config().operator}, 'fictional-tenant', 'fictional-amina') ON CONFLICT DO NOTHING`,
  );
  const result = await d.execute(
    sql`SELECT tenant, owner FROM fm_principals WHERE operator_id=${authenticatedOperator}`,
  );
  if (!result.rows.length)
    throw new AppError("Financial access unavailable", 403);
  const row = result.rows[0] as { tenant: string; owner: string };
  return {
    tenantId: row.tenant,
    actorId: row.owner,
    requestId: randomUUID(),
    now: new Date().toISOString(),
  };
}
let dispatcher: ReadToolDispatcher | undefined;
export function financialDispatcher(): ReadToolDispatcher {
  requireFinancialDemo();
  if (!dispatcher) {
    const repository = createDurableRepository();
    const source = createFixtureDataSource({ repository });
    dispatcher = createReadTools({ repository, sources: [source] });
  }
  return dispatcher;
}
