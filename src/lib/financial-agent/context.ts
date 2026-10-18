import { z } from "zod";
import {
  IdSchema,
  InstantSchema,
  ReadFilterSchema,
} from "../financial-data/contracts";
import { bytes, AgentError } from "./protocol";

export const ContextKeySchema = z.strictObject({
  tenantId: IdSchema,
  actorId: IdSchema,
  conversationId: IdSchema,
});
export type ContextKey = z.infer<typeof ContextKeySchema>;
export const SelectionSchema = z.strictObject({
  resultId: IdSchema,
  accountIds: z.array(IdSchema).min(1).max(5),
  candidates: z
    .array(
      z.strictObject({
        accountId: IdSchema,
        transactionId: IdSchema,
        untrustedCounterpartyLabel: z.string().max(100).nullable(),
        revision: z.number().int().positive(),
        amountKobo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(25),
  filter: ReadFilterSchema.nullable(),
  accessVersion: z.string().min(1).max(256),
  expiresAt: InstantSchema,
});
export const ContextSchema = z
  .strictObject({
    ...ContextKeySchema.shape,
    schemaVersion: z.literal(1),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(1800),
        }),
      )
      .max(16),
    selection: SelectionSchema.nullable(),
  })
  .refine((v) => bytes(v.messages) <= 12 * 1024);
export type ConversationContext = z.infer<typeof ContextSchema>;
/** Implement load/CAS atomically and with composite principal keys in durable integration storage. */
export interface ContextStore {
  load(key: ContextKey): Promise<unknown | null>;
  compareAndSwap(
    key: ContextKey,
    expectedRevision: number | null,
    next: ConversationContext,
  ): Promise<boolean>;
}
export class MemoryContextStore implements ContextStore {
  private rows = new Map<string, ConversationContext>();
  async load(key: ContextKey) {
    const row = this.rows.get(JSON.stringify(ContextKeySchema.parse(key)));
    return row ? structuredClone(row) : null;
  }
  async compareAndSwap(
    key: ContextKey,
    expected: number | null,
    next: ConversationContext,
  ) {
    const k = JSON.stringify(ContextKeySchema.parse(key));
    const row = this.rows.get(k);
    if ((row?.revision ?? null) !== expected) return false;
    const parsed = ContextSchema.parse(next);
    if (
      parsed.tenantId !== key.tenantId ||
      parsed.actorId !== key.actorId ||
      parsed.conversationId !== key.conversationId ||
      parsed.revision !== (expected ?? 0) + 1
    )
      throw new AgentError("CONTEXT_INVALID");
    this.rows.set(k, structuredClone(parsed));
    return true;
  }
}
export function boundedMessages(messages: ConversationContext["messages"]) {
  const result = messages
    .slice(-16)
    .map((m) => ({ ...m, text: m.text.slice(0, 1800) }));
  while (bytes(result) > 12 * 1024) result.shift();
  return result;
}
