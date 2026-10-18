import { operator, sameOrigin } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { chatHistory } from "@/lib/chat-history/store";
import { requireFinancialDemo } from "@/lib/financial-integration/service";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const headers = {
    "Cache-Control": "no-store, private",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    if (req.headers.has("origin")) sameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      throw new AppError("Origin rejected", 403);
    const history = chatHistory(await operator(req));
    requireFinancialDemo();
    const params = new URL(req.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== "id") ||
      params.getAll("id").length > 1
    )
      throw new AppError("Invalid query", 400);
    const id = params.get("id");
    return Response.json(
      id !== null
        ? { turns: await history.read(id) }
        : { chats: await history.list() },
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    return Response.json(
      {
        error: {
          code:
            status === 401
              ? "UNAUTHORIZED"
              : status === 404
                ? "NOT_FOUND"
                : status === 400
                  ? "INVALID_ARGUMENT"
                  : "UNAVAILABLE",
        },
      },
      { status, headers },
    );
  }
}
