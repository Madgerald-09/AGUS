import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { conversationPayment } from "@/lib/conversation-payment";
import { requireFinancialDemo } from "@/lib/financial-integration/service";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await operator(req);
    requireFinancialDemo();
    if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
      throw new AppError("JSON required", 415);
    const reader = req.body?.getReader();
    if (!reader) throw new SyntaxError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        throw new AppError("Request too large", 413);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const { conversationId, turnId } = z
      .object({ conversationId: z.string().uuid(), turnId: z.string().uuid() })
      .strict()
      .parse(JSON.parse(body));
    return Response.json(
      await conversationPayment(owner, conversationId, turnId),
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : "Payment draft unavailable. Check saved payments before trying again.",
      },
      {
        status:
          e instanceof AppError
            ? e.status
            : e instanceof z.ZodError || e instanceof SyntaxError
              ? 400
              : 503,
      },
    );
  }
}
