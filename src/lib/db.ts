import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { pgTable, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { seedState, type State, AppError } from "./domain";
export const workflow = pgTable("workflow_state", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
  payload: jsonb("payload").$type<State>().notNull(),
});
export const sessions = pgTable("operator_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  operatorId: text("operator_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const attempts = pgTable("auth_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
async function connect() {
  const url = process.env.DATABASE_URL ?? "pglite://.data/agent";
  if (url.startsWith("postgres"))
    return pgDrizzle(new Pool({ connectionString: url, max: 5 }));
  if (process.env.PAYMENT_MODE === "live")
    throw new AppError("Embedded storage is forbidden in live mode", 503);
  const path = url.replace("pglite://", "");
  if (path !== ":memory:") await mkdir(path, { recursive: true });
  return liteDrizzle(new PGlite(path === ":memory:" ? undefined : path));
}
type DB = Awaited<ReturnType<typeof connect>>;
const g = globalThis as unknown as { agentDB?: Promise<DB> };
export function db() {
  return (g.agentDB ??= connect().then(async (d) => {
    await d.execute(
      sql`CREATE TABLE IF NOT EXISTS workflow_state (id integer PRIMARY KEY CHECK (id = 1), revision integer NOT NULL DEFAULT 0, payload jsonb NOT NULL)`,
    );
    await d.execute(
      sql`CREATE TABLE IF NOT EXISTS operator_sessions (token_hash text PRIMARY KEY, operator_id text NOT NULL, expires_at timestamptz NOT NULL)`,
    );
    await d.execute(
      sql`CREATE TABLE IF NOT EXISTS auth_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL)`,
    );
    await d
      .insert(workflow)
      .values({ id: 1, revision: 0, payload: seedState() })
      .onConflictDoNothing();
    return d;
  }));
}
export async function readState() {
  const d = await db();
  const [r] = await d.select().from(workflow).where(eq(workflow.id, 1));
  return r.payload;
}
// Pure synchronous reducers may be replayed on CAS contention. Never call a provider in a reducer.
export async function mutate<T>(fn: (s: State) => T): Promise<T> {
  const d = await db();
  for (let i = 0; i < 30; i++) {
    const [r] = await d.select().from(workflow).where(eq(workflow.id, 1));
    const s = structuredClone(r.payload);
    const result = fn(s);
    const updated = await d
      .update(workflow)
      .set({ payload: s, revision: r.revision + 1 })
      .where(and(eq(workflow.id, 1), eq(workflow.revision, r.revision)))
      .returning();
    if (updated.length) return result;
  }
  throw new AppError("Concurrent update; refresh and try again", 409);
}
