import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../domain";
import { IdSchema, type Principal } from "../financial-data/contracts";

type ContextKey = Principal & { conversationId: string };
type VersionedContext = ContextKey & { schemaVersion: 1; revision: number };

/** Lossless SQL CAS adapter for a server-injected context schema. No model/client
 * may provide the parser. B remains responsible for scrubbing and current access
 * checks; storage alone never makes persisted selections authoritative facts. */
export function createContextPersistence<T extends VersionedContext>(
  principal: Principal,
  parse: (input: unknown) => T,
  clock = () => new Date().toISOString(),
  options: { renewExpired?: boolean } = {},
) {
  const owner = Object.freeze({ ...principal });
  // This adapter belongs to one agent turn. Bind numeric CAS to the exact row
  // lifetime it observed, so resetting an expired revision cannot admit an old
  // in-flight turn (the revision-1 ABA problem).
  const observedExpiry = new Map<string, string>();
  function key(input: ContextKey) {
    IdSchema.parse(input.conversationId);
    if (input.tenantId !== owner.tenantId || input.actorId !== owner.actorId)
      throw new AppError("Context scope rejected", 403);
    // Distinct namespace from the foundation's authorized-selection store.
    return `agentb.${input.conversationId}`;
  }
  function validate(input: unknown, k: ContextKey, revision: number) {
    const value = parse(input);
    if (
      value.tenantId !== owner.tenantId ||
      value.actorId !== owner.actorId ||
      value.conversationId !== k.conversationId ||
      value.schemaVersion !== 1 ||
      value.revision !== revision
    )
      throw new AppError("Context scope or revision rejected", 409);
    return value;
  }
  return Object.freeze({
    async load(k: ContextKey): Promise<T | null> {
      const id = key(k);
      const d = await db();
      const result = await d.execute(
        sql`SELECT revision, payload, expires_at::text AS expiry FROM fm_context WHERE tenant=${owner.tenantId} AND owner=${owner.actorId} AND id=${id} AND expires_at > ${clock()}::timestamptz`,
      );
      if (!result.rows.length) {
        observedExpiry.delete(id);
        return null;
      }
      const row = result.rows[0] as {
        revision: number;
        payload: unknown;
        expiry: string;
      };
      observedExpiry.set(id, row.expiry);
      return validate(row.payload, k, row.revision);
    },
    async compareAndSwap(
      k: ContextKey,
      expected: number | null,
      next: T,
    ): Promise<boolean> {
      const id = key(k);
      if (
        expected !== null &&
        (!Number.isInteger(expected) || expected < 1 || expected >= 2147483647)
      )
        throw new AppError("Invalid context revision", 400);
      const revision = (expected ?? 0) + 1;
      const value = validate(next, k, revision);
      const payload = JSON.stringify(value);
      if (Buffer.byteLength(payload) > 32768)
        throw new AppError("Context too large", 413);
      const now = clock();
      const expiry = new Date(Date.parse(now) + 15 * 60000).toISOString();
      const d = await db();
      const observed = observedExpiry.get(id);
      if (expected !== null && !observed) return false;
      const result =
        expected === null
          ? options.renewExpired
            ? await d.execute(sql`INSERT INTO fm_context VALUES (${owner.tenantId}, ${owner.actorId}, ${id}, 1, ${expiry}::timestamptz, ${payload}::jsonb)
          ON CONFLICT (tenant, owner, id) DO UPDATE SET revision=1, expires_at=EXCLUDED.expires_at, payload=EXCLUDED.payload
          WHERE fm_context.expires_at <= ${now}::timestamptz RETURNING revision`)
            : await d.execute(sql`INSERT INTO fm_context VALUES (${owner.tenantId}, ${owner.actorId}, ${id}, 1, ${expiry}::timestamptz, ${payload}::jsonb)
          ON CONFLICT DO NOTHING RETURNING revision`)
          : await d.execute(sql`UPDATE fm_context SET revision=${revision}, expires_at=${expiry}::timestamptz, payload=${payload}::jsonb
          WHERE tenant=${owner.tenantId} AND owner=${owner.actorId} AND id=${id} AND revision=${expected} AND expires_at=${observed}::timestamptz AND expires_at > ${now}::timestamptz RETURNING revision`);
      if (result.rows.length === 1) observedExpiry.set(id, expiry);
      return result.rows.length === 1;
    },
  });
}
