import { createHash } from "node:crypto";
import {
  AccountRecordSchema,
  ConsentSchema,
  IdSchema,
  type FinancialRepository,
  type PermissionContext,
  type Scope,
} from "../financial-data/contracts";
import { AgentError } from "./protocol";

export type AccessSnapshot = {
  accountIds: string[];
  version: string;
  expiresAt: string;
};
/** Server-owned resolver. Never accept account bindings or this snapshot from the model/client. */
export interface AccessResolver {
  check(
    ctx: PermissionContext,
    accountIds: string[],
    scopes: Scope[],
  ): Promise<AccessSnapshot>;
}
export function createRepositoryAccess(
  repository: FinancialRepository,
  clock: () => string,
): AccessResolver {
  return {
    async check(ctx, ids, scopes) {
      if (!ids.length || ids.length > 5 || new Set(ids).size !== ids.length)
        throw new AgentError("PERMISSION_DENIED");
      const revisions: unknown[] = [];
      let expiresAt = "9999-01-01T00:00:00.000Z";
      const now = Date.parse(clock());
      if (!Number.isFinite(now)) throw new AgentError("PERMISSION_DENIED");
      for (const id of ids) {
        IdSchema.parse(id);
        const a = AccountRecordSchema.parse(
          await repository.getAccount(ctx, id),
        );
        const c = ConsentSchema.parse(
          await repository.getConsent(ctx, a.consentId),
        );
        if (
          a.tenantId !== ctx.tenantId ||
          a.ownerId !== ctx.actorId ||
          c.tenantId !== ctx.tenantId ||
          c.ownerId !== ctx.actorId ||
          c.provider !== a.provider ||
          c.mode !== a.mode ||
          c.state !== "active" ||
          Date.parse(c.grantedAt) > now ||
          Date.parse(c.expiresAt) <= now ||
          !c.accountIds.includes(id) ||
          scopes.some((s) => !c.scopes.includes(s))
        )
          throw new AgentError("PERMISSION_DENIED");
        if (Date.parse(c.expiresAt) < Date.parse(expiresAt))
          expiresAt = c.expiresAt;
        revisions.push([id, c.id, c.version, c.expiresAt]);
      }
      revisions.push(await repository.getRevision(ctx, ids));
      return {
        accountIds: [...ids],
        version: createHash("sha256")
          .update(JSON.stringify(revisions))
          .digest("hex"),
        expiresAt,
      };
    },
  };
}
