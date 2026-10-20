import { sql } from "drizzle-orm";
import { z } from "zod";
import { sameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { ToolCallSchema } from "@/lib/financial-data/contracts";
import { FinancialDataError } from "@/lib/financial-data/core";
import { createAuthorizer } from "@/lib/financial-data/permissions";
import { createDurableRepository } from "@/lib/financial-integration/storage";
import {
  financialContext,
  simulation,
} from "@/lib/financial-integration/service";
import { authorizedFinancialAccess } from "@/lib/financial-integration/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(
    { simulation, ...(data as object) },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        Vary: "Cookie, Origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
function errorReply(error: unknown) {
  if (error instanceof AppError)
    return reply(
      {
        error: {
          code:
            error.status === 401
              ? "UNAUTHORIZED"
              : error.status === 403
                ? "FORBIDDEN"
                : error.status === 413
                  ? "REQUEST_TOO_LARGE"
                  : "UNAVAILABLE",
        },
      },
      error.status,
    );
  if (error instanceof FinancialDataError)
    return reply({ error: { code: error.code } }, 403);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return reply({ error: { code: "INVALID_ARGUMENT" } }, 400);
  return reply({ error: { code: "UNAVAILABLE" } }, 503);
}
async function body(req: Request) {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new AppError("JSON required", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new AppError("Request too large", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function GET(req: Request) {
  try {
    if (req.headers.has("origin")) sameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      throw new AppError("Origin rejected", 403);
    const ctx = await financialContext(req);
    if (new URL(req.url).search) throw new SyntaxError();
    const d = await db();
    const rows = await d.execute(
      sql`SELECT id FROM fm_accounts WHERE tenant=${ctx.tenantId} AND owner=${ctx.actorId} ORDER BY id`,
    );
    const auth = createAuthorizer(createDurableRepository(), () =>
      new Date().toISOString(),
    );
    const ids = rows.rows.map((r) => r.id as string);
    const bindings = await auth.bind(ctx, ids, ["accounts:read"]);
    const accounts = bindings.map(({ account: a }) => ({
      accountId: a.accountId,
      displayName: a.displayName,
      maskedNumber: a.maskedNumber,
      currency: a.currency,
      simulated: a.simulated,
      source: { provider: a.provider, mode: a.mode },
    }));
    await auth.recheck(ctx, bindings, ["accounts:read"]);
    return reply({ accounts });
  } catch (error) {
    return errorReply(error);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const access = await authorizedFinancialAccess(req);
    if (new URL(req.url).search) throw new SyntaxError();
    const call = ToolCallSchema.parse(await body(req));
    const result = await access.tools.dispatch(access.context, call);
    const code = result.error?.code;
    const status = !code
      ? 200
      : code === "NOT_FOUND"
        ? 404
        : code === "INVALID_ARGUMENT" || code === "CURSOR_INVALID"
          ? 400
          : code.startsWith("CONSENT_") || code === "PERMISSION_DENIED"
            ? 403
            : 503;
    return reply({ result }, status);
  } catch (error) {
    return errorReply(error);
  }
}
