import {
  AccountRecordSchema,
  ConsentSchema,
  PermissionContextSchema,
  type AccountRecord,
  type Consent,
  type FinancialRepository,
  type PermissionContext,
  type Scope,
} from "./contracts";
import { fail, parseProvider, trustedNow } from "./core";

export type AccessBinding = { account: AccountRecord; consent: Consent };
export function createAuthorizer(
  repository: FinancialRepository,
  clock: () => string,
) {
  const context = (ctx: PermissionContext): PermissionContext =>
    PermissionContextSchema.parse({ ...ctx, now: trustedNow(clock) });
  async function consent(
    ctx: PermissionContext,
    id: string,
    scopes: Scope[],
  ): Promise<Consent> {
    const c = await repository.getConsent(ctx, id);
    if (!c) fail("CONSENT_REQUIRED");
    const value = parseProvider(ConsentSchema, c);
    if (value.tenantId !== ctx.tenantId || value.ownerId !== ctx.actorId)
      fail("CONSENT_REQUIRED");
    if (value.state === "revoked" || value.revokedAt) fail("CONSENT_REVOKED");
    const now = Date.parse(trustedNow(clock));
    if (value.state === "expired" || Date.parse(value.expiresAt) <= now)
      fail("CONSENT_EXPIRED");
    if (
      Date.parse(value.grantedAt) > now ||
      scopes.some((s) => !value.scopes.includes(s))
    )
      fail("PERMISSION_DENIED");
    return value;
  }
  async function bind(
    ctx: PermissionContext,
    accountIds: string[],
    scopes: Scope[],
    hide = false,
  ): Promise<AccessBinding[]> {
    const bindings: AccessBinding[] = [];
    // Validate the entire selection before any provider call or disclosure.
    for (const id of accountIds) {
      const raw = await repository.getAccount(ctx, id);
      if (!raw) fail(hide ? "NOT_FOUND" : "PERMISSION_DENIED");
      const a = parseProvider(AccountRecordSchema, raw);
      if (
        a.tenantId !== ctx.tenantId ||
        a.ownerId !== ctx.actorId ||
        a.accountId !== id
      )
        fail(hide ? "NOT_FOUND" : "PERMISSION_DENIED");
      const c = await consent(ctx, a.consentId, scopes);
      if (
        !c.accountIds.includes(id) ||
        c.provider !== a.provider ||
        c.mode !== a.mode
      )
        fail("PERMISSION_DENIED");
      bindings.push({ account: a, consent: c });
    }
    return bindings;
  }
  async function recheck(
    ctx: PermissionContext,
    bindings: AccessBinding[],
    scopes: Scope[],
  ): Promise<void> {
    const current = await bind(
      ctx,
      bindings.map((b) => b.account.accountId),
      scopes,
    );
    if (
      current.some(
        (b, i) =>
          b.consent.version !== bindings[i].consent.version ||
          JSON.stringify(b.account) !== JSON.stringify(bindings[i].account),
      )
    )
      fail("SNAPSHOT_EXPIRED");
  }
  return { context, consent, bind, recheck };
}
