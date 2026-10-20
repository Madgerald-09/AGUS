import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../domain";
import { IdSchema } from "../financial-data/contracts";
import { scrub } from "../financial-agent/protocol";
import type { AgentReply } from "../financial-agent";

export type SavedTurn = {
  id: string;
  text: string;
  reply: AgentReply;
  createdAt: string;
};
export type SavedChat = { id: string; title: string; updatedAt: string };
let initializing: Promise<void> | undefined;
async function storage() {
  const d = await db();
  await (initializing ??= (async () => {
    await d.execute(sql`CREATE TABLE IF NOT EXISTS chat_history (
      owner text NOT NULL, id text NOT NULL, title text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), lease text, lease_until timestamptz,
      PRIMARY KEY (owner, id))`);
    await d.execute(sql`CREATE TABLE IF NOT EXISTS chat_turns (
      owner text NOT NULL, chat text NOT NULL, id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
      PRIMARY KEY (owner, chat, id),
      FOREIGN KEY (owner, chat) REFERENCES chat_history(owner, id))`);
    await d.execute(
      sql`CREATE INDEX IF NOT EXISTS chat_history_recent ON chat_history(owner, updated_at DESC, id)`,
    );
  })().catch((error) => {
    initializing = undefined;
    throw error;
  }));
  return d;
}
/** The owner is always the authenticated operator, never a request field.
 * Transcripts are display-only: they never seed the agent's permission/selection context. */
export function chatHistory(owner: string) {
  if (!owner) throw new AppError("Sign in to continue", 401);
  return {
    async inProgress(id: string): Promise<boolean> {
      IdSchema.parse(id);
      const d = await storage();
      const result = await d.execute(
        sql`SELECT id FROM chat_history WHERE owner=${owner} AND id=${id} AND lease_until > now()`,
      );
      return result.rows.length > 0;
    },
    async list(): Promise<SavedChat[]> {
      const d = await storage();
      const result = await d.execute(
        sql`SELECT id, title, updated_at AS "updatedAt" FROM chat_history WHERE owner=${owner} ORDER BY updated_at DESC, id`,
      );
      return result.rows as SavedChat[];
    },
    async read(id: string): Promise<SavedTurn[]> {
      IdSchema.parse(id);
      const d = await storage();
      const exists = await d.execute(
        sql`SELECT id FROM chat_history WHERE owner=${owner} AND id=${id}`,
      );
      if (!exists.rows.length) throw new AppError("Chat not found", 404);
      const result = await d.execute(
        sql`SELECT payload FROM chat_turns WHERE owner=${owner} AND chat=${id} ORDER BY created_at, id`,
      );
      return result.rows.map((row) => row.payload as SavedTurn);
    },
    async claim(id: string, text: string) {
      IdSchema.parse(id);
      const d = await storage();
      const lease = randomUUID();
      const title = scrub(text).replace(/\s+/g, " ").trim().slice(0, 72);
      await d.execute(
        sql`INSERT INTO chat_history (owner,id,title) VALUES (${owner},${id},${title}) ON CONFLICT DO NOTHING`,
      );
      const result = await d.execute(
        sql`UPDATE chat_history SET lease=${lease}, lease_until=now() + interval '90 seconds' WHERE owner=${owner} AND id=${id} AND (lease_until IS NULL OR lease_until < now()) RETURNING id`,
      );
      if (!result.rows.length)
        throw new AppError("A response is already in progress", 409);
      return lease;
    },
    async finish(
      id: string,
      lease: string,
      text: string,
      reply: AgentReply,
    ): Promise<SavedTurn> {
      const d = await storage();
      const turn: SavedTurn = {
        id: randomUUID(),
        text: scrub(text),
        reply,
        createdAt: new Date().toISOString(),
      };
      await d.transaction(async (tx) => {
        const result = await tx.execute(
          sql`UPDATE chat_history SET lease=NULL, lease_until=NULL, updated_at=now() WHERE owner=${owner} AND id=${id} AND lease=${lease} RETURNING id`,
        );
        if (!result.rows.length) throw new AppError("Chat changed", 409);
        await tx.execute(
          sql`INSERT INTO chat_turns (owner,chat,id,payload) VALUES (${owner},${id},${turn.id},${JSON.stringify(turn)}::jsonb)`,
        );
      });
      return turn;
    },
    async release(id: string, lease: string) {
      const d = await storage();
      await d.execute(
        sql`UPDATE chat_history SET lease=NULL, lease_until=NULL WHERE owner=${owner} AND id=${id} AND lease=${lease}`,
      );
    },
  };
}
