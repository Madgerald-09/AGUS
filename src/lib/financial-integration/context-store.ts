import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../domain";
import {
  IdSchema,
  ReadFilterSchema,
  type FinancialRepository,
  type PermissionContext,
  type Scope,
} from "../financial-data/contracts";
import { createAuthorizer } from "../financial-data/permissions";
import { FinancialDataError } from "../financial-data/core";

export const ConversationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accountIds: z
    .array(IdSchema)
    .min(1)
    .max(5)
    .refine((a) => new Set(a).size === a.length),
  selected: z
    .strictObject({ accountId: IdSchema, transactionId: IdSchema })
    .nullable(),
  candidateSet: z
    .strictObject({
      resultId: IdSchema,
      filters: ReadFilterSchema,
      query: z.string().max(200),
      candidates: z
        .array(
          z.strictObject({
            accountId: IdSchema,
            transactionId: IdSchema,
            revision: z.number().int().positive().safe(),
          }),
        )
        .min(1)
        .max(25),
    })
    .nullable()
    .optional(),
  // Untrusted transcript, never an authoritative fact catalogue or instruction source.
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(2000),
      }),
    )
    .max(16),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;
export interface ScopedContextStore {
  load(
    id: string,
  ): Promise<{ revision: number; state: ConversationState } | null>;
  save(
    id: string,
    expectedRevision: number,
    state: ConversationState,
  ): Promise<number>;
}

/** Inject only this bound interface into B; no caller-supplied owner/tenant keys. */
export function createContextStore(
  ctx: PermissionContext,
  repository: FinancialRepository,
  clock = () => new Date().toISOString(),
): ScopedContextStore {
  const principal = Object.freeze({ ...ctx });
  const auth = createAuthorizer(repository, clock);
  const scopes: Scope[] = [
    "accounts:read",
    "transactions:read",
    "evidence:read",
  ];
  async function validate(state: ConversationState) {
    const bindings = await auth.bind(principal, state.accountIds, scopes);
    if (state.selected) {
      if (
        !state.accountIds.includes(state.selected.accountId) ||
        !(await repository.getTransaction(
          principal,
          state.selected.accountId,
          state.selected.transactionId,
        ))
      )
        throw new FinancialDataError("NOT_FOUND");
    }
    if (state.candidateSet) {
      if (
        state.candidateSet.filters.accountIds.some(
          (id) => !state.accountIds.includes(id),
        )
      )
        throw new FinancialDataError("PERMISSION_DENIED");
      for (const ref of state.candidateSet.candidates) {
        if (!state.accountIds.includes(ref.accountId))
          throw new FinancialDataError("NOT_FOUND");
        const transaction = await repository.getTransaction(
          principal,
          ref.accountId,
          ref.transactionId,
        );
        if (!transaction || transaction.revision !== ref.revision)
          throw new FinancialDataError("SNAPSHOT_EXPIRED");
      }
    }
    const sourceRevision = await repository.getRevision(
      principal,
      state.accountIds,
    );
    await auth.recheck(principal, bindings, scopes);
    return sourceRevision;
  }
  return {
    async load(id) {
      IdSchema.parse(id);
      const d = await db();
      const result = await d.execute(
        sql`SELECT revision, payload FROM fm_context WHERE tenant=${principal.tenantId} AND owner=${principal.actorId} AND id=${id} AND expires_at > ${clock()}::timestamptz`,
      );
      if (!result.rows.length) return null;
      const row = result.rows[0] as {
        revision: number;
        payload: { state: unknown; sourceRevision: string };
      };
      const state = ConversationStateSchema.parse(row.payload.state);
      if ((await validate(state)) !== row.payload.sourceRevision)
        throw new FinancialDataError("SNAPSHOT_EXPIRED");
      return { revision: row.revision, state };
    },
    async save(id, expectedRevision, input) {
      IdSchema.parse(id);
      z.number().int().min(0).max(2147483646).parse(expectedRevision);
      const state = ConversationStateSchema.parse(input);
      if (Buffer.byteLength(JSON.stringify(state.messages)) > 12288)
        throw new AppError("Transcript too large", 413);
      const sourceRevision = await validate(state);
      const payload = JSON.stringify({ state, sourceRevision });
      if (Buffer.byteLength(payload) > 16384)
        throw new AppError("Context too large", 413);
      const expires = new Date(Date.parse(clock()) + 15 * 60000).toISOString();
      const d = await db();
      const result =
        expectedRevision === 0
          ? await d.execute(
              sql`INSERT INTO fm_context VALUES (${principal.tenantId}, ${principal.actorId}, ${id}, 1, ${expires}::timestamptz, ${payload}::jsonb) ON CONFLICT DO NOTHING RETURNING revision`,
            )
          : await d.execute(
              sql`UPDATE fm_context SET revision=revision+1, expires_at=${expires}::timestamptz, payload=${payload}::jsonb WHERE tenant=${principal.tenantId} AND owner=${principal.actorId} AND id=${id} AND revision=${expectedRevision} AND expires_at > ${clock()}::timestamptz RETURNING revision`,
            );
      if (!result.rows.length)
        throw new AppError("Context changed; reload before continuing", 409);
      if ((await validate(state)) !== sourceRevision)
        throw new FinancialDataError("SNAPSHOT_EXPIRED");
      return expectedRevision + 1;
    },
  };
}
