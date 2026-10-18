import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import {
  ConversationInput,
  conversationTurn,
} from "@/lib/financial-integration/conversation";
import {
  simulation,
  requireFinancialDemo,
} from "@/lib/financial-integration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: object, status = 200) =>
  Response.json(
    { simulation, ...data },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        Vary: "Cookie, Origin",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await operator(req);
    requireFinancialDemo();
    if (new URL(req.url).search) throw new SyntaxError();
    if (
      req.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
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
      if (size > 16384) {
        await reader.cancel();
        throw new AppError("Request too large", 413);
      }
      chunks.push(value);
    }
    const input = ConversationInput.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    const result = await conversationTurn(req, input);
    return reply(
      { conversationId: input.conversationId, reply: result },
      result.kind === "conflict"
        ? 409
        : result.kind === "unavailable"
          ? 503
          : 200,
    );
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    const code =
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 400
            ? "INVALID_ARGUMENT"
            : status === 413
              ? "REQUEST_TOO_LARGE"
              : "UNAVAILABLE";
    return reply({ error: { code } }, status);
  }
}
