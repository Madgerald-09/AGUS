import { z } from "zod";
import { AppError, audit, digest, now } from "@/lib/domain";
import { presentMessage } from "@/lib/conversation-policy";
import { config } from "@/lib/config";
import {
  operator,
  sameOrigin,
  login,
  logout,
  sessionCookie,
  checkPassword,
} from "@/lib/auth";
import { mutate, readState } from "@/lib/db";
import { provider, fixtureBeneficiaries } from "@/lib/paystack";
import {
  approveBatch,
  editBatch,
  executeBatch,
  finalizeOTP,
  preparePaymentBatch,
  reconcileBatch,
  verifyBeneficiaries,
  webhook,
} from "@/lib/payments";
import {
  analyzeSpending,
  chat,
  exportPaymentReport,
  extractImage,
  proposedSchema,
  transcribeAudio,
} from "@/lib/intelligence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers });
async function boundedBody(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError("Request too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function json(req: Request) {
  return JSON.parse((await boundedBody(req, 65536)).toString("utf8"));
}
async function handle(req: Request) {
  try {
    const path = new URL(req.url).pathname.replace(/^\/api\//, "").split("/");
    const action = path[0];
    if (
      action === "webhooks" &&
      path[1] === "paystack" &&
      req.method === "POST"
    ) {
      const raw = (await boundedBody(req, 1024 * 1024)).toString("utf8");
      return reply(await webhook(raw, req.headers.get("x-paystack-signature")));
    }
    if (req.method !== "GET") sameOrigin(req);
    if (action === "session" && req.method === "POST") {
      const input = z
        .object({ password: z.string().min(1).max(256) })
        .parse(await json(req));
      const token = await login(input.password);
      return reply({ authenticated: true }, 200, {
        "Set-Cookie": sessionCookie(token),
      });
    }
    if (action === "session" && req.method === "DELETE") {
      await logout(req);
      return reply({ authenticated: false }, 200, {
        "Set-Cookie": sessionCookie(""),
      });
    }
    const actor = await operator(req);
    if (action === "state" && req.method === "GET") {
      const s = await readState();
      const c = config();
      return reply({
        operator: actor,
        mode: c.mode,
        aiEnabled:
          !!process.env.AI_API_KEY &&
          ["openai", "gemini"].includes(process.env.AI_PROVIDER ?? ""),
        emergencyDisabled:
          s.emergencyDisabled ||
          process.env.PAYMENTS_EMERGENCY_DISABLED === "true",
        liveEnabled:
          c.mode === "live" && process.env.LIVE_TRANSFERS_ENABLED === "true",
        maxPaymentKobo: c.maxPayment,
        maxBatchKobo: c.maxBatch,
        feeReserveKobo: c.feeReserve,
        batches: s.batches
          .filter((b) => b.owner === actor)
          .map((b) => ({ ...b, reviewDigest: digest(b) })),
        messages: s.messages
          .filter((m) => !m.owner || m.owner === actor)
          .map(presentMessage),
        aiProvider: process.env.AI_PROVIDER ?? "none",
        ledger: s.ledger,
        insights: analyzeSpending(s.ledger),
        audit: s.audit
          .filter((e) => e.actor === actor || e.actor === "paystack")
          .slice(-100),
        executionRejections: s.audit
          .filter(
            (e) => e.actor === actor && e.action === "batch.execution_rejected",
          )
          .map((e) => ({
            batchId: e.batchId,
            attemptId: (e.details as { attemptId: string }).attemptId,
          })),
        fixtureBeneficiaries: c.mode === "fixture" ? fixtureBeneficiaries : [],
      });
    }
    if (action === "banks" && req.method === "GET")
      return reply(await provider().banks());
    if (action === "balance" && req.method === "GET") {
      const r = await provider().balance();
      return reply({ availableKobo: r.data, mode: config().mode, at: now() });
    }
    if (action === "reports" && req.method === "GET")
      return new Response(exportPaymentReport(await readState(), actor), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="payment-report.csv"',
          "Cache-Control": "no-store",
        },
      });
    if (action === "emergency" && req.method === "POST") {
      const { disabled } = z
        .object({ disabled: z.boolean() })
        .parse(await json(req));
      return reply(
        await mutate((s) => {
          s.emergencyDisabled = disabled;
          audit(s, actor, "emergency.changed", { disabled });
          return { disabled };
        }),
      );
    }
    if (action === "chat" && req.method === "POST") {
      const { message } = z
        .object({ message: z.string().trim().min(1).max(4000) })
        .parse(await json(req));
      if (req.headers.get("accept") === "application/x-ndjson") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let connected = true;
            const emit = (event: unknown) => {
              if (!connected) return;
              try {
                controller.enqueue(
                  encoder.encode(JSON.stringify(event) + "\n"),
                );
              } catch {
                connected = false;
              }
            };
            try {
              const result = await chat(actor, message, (activity) =>
                emit({ activity }),
              );
              emit({ result });
            } catch (e) {
              // Same privacy boundary as ordinary responses: never expose raw
              // model output, transport errors, prompts or credentials.
              emit({
                ok: false,
                status: e instanceof AppError ? e.status : 502,
                error:
                  e instanceof AppError
                    ? e.message
                    : "The assistant response could not be completed. Your input is preserved.",
              });
            } finally {
              if (connected) controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return reply(await chat(actor, message));
    }
    if (action === "voice" && req.method === "POST") {
      const bytes = await boundedBody(req, 10 * 1024 * 1024);
      const form = await new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": req.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("audio");
      if (!(file instanceof File))
        throw new AppError("A voice recording is required");
      const requestedMime = file.type.split(";")[0].toLowerCase();
      const mimeType =
        requestedMime === "audio/x-wav" ? "audio/wav" : requestedMime;
      if (
        ![
          "audio/aac",
          "audio/flac",
          "audio/mp4",
          "audio/mpeg",
          "audio/ogg",
          "audio/wav",
          "audio/webm",
        ].includes(mimeType)
      )
        throw new AppError("This browser's audio format is not supported.", 415);
      return reply(
        {
          transcript: await transcribeAudio(
            Buffer.from(await file.arrayBuffer()),
            mimeType,
          ),
        },
      );
    }
    if (action === "extract" && req.method === "POST") {
      if (Number(req.headers.get("content-length") ?? 0) > 6 * 1024 * 1024)
        throw new AppError("Upload too large", 413);
      const bytes = await boundedBody(req, 6 * 1024 * 1024);
      const form = await new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": req.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("image");
      if (!(file instanceof File)) throw new AppError("Image file required");
      return reply(
        await extractImage(
          Buffer.from(await file.arrayBuffer()),
          file.type,
          actor,
        ),
      );
    }
    if (action === "proposals" && req.method === "POST") {
      const { proposals } = z
        .object({
          proposals: z
            .array(
              proposedSchema.extend({
                // Editable partial input is stored as a draft only. Extracted model
                // fields and saved payment instructions retain their strict schemas.
                bankCode: z
                  .string()
                  .regex(/^\d{1,6}$/)
                  .nullable(),
                accountNumber: z
                  .string()
                  .regex(/^\d{1,10}$/)
                  .nullable(),
                amountNaira: z
                  .string()
                  .regex(/^\d+(\.\d{0,2})?$/)
                  .nullable(),
              }),
            )
            .min(1)
            .max(10),
        })
        .strict()
        .parse(await json(req));
      return reply(
        await mutate((s) => {
          const message = s.messages.find(
            (m) =>
              m.id === path[1] && m.owner === actor && m.role === "assistant",
          );
          if (!message || !message.proposals?.length)
            throw new AppError("Proposal not found", 404);
          if (message.batchId || message.supersededBy)
            throw new AppError(
              "This proposal already has a payment batch. Edit the payment card instead.",
              409,
            );
          message.proposals = proposals;
          return { saved: true };
        }),
      );
    }
    if (action === "batches" && req.method === "POST") {
      const body = await json(req);
      const batchId = path[1];
      const operation = path[2];
      if (!batchId) {
        const { payments, sourceMessageId } = z
          .object({
            payments: z.unknown(),
            sourceMessageId: z.string().uuid().optional(),
          })
          .parse(body);
        const batch = await preparePaymentBatch(
          actor,
          payments,
          sourceMessageId,
        );
        return reply(batch, 201);
      }
      if (operation === "edit") {
        const { payments, expectedVersion } = z
          .object({
            payments: z.unknown(),
            expectedVersion: z.number().int().positive().optional(),
          })
          .parse(body);
        return reply(
          await editBatch(actor, batchId, payments, expectedVersion),
        );
      }
      if (operation === "verify")
        return reply(await verifyBeneficiaries(actor, batchId));
      if (operation === "approve") {
        const { password, reviewDigest } = z
          .object({
            password: z.string().max(256),
            reviewDigest: z.string().length(64),
          })
          .parse(body); // Reuse rate-limited password authentication; immediately revoke the extra session.
        const token = await login(password);
        await logout(
          new Request(req.url, { headers: { cookie: `ha_session=${token}` } }),
        );
        if (!checkPassword(password, process.env.OPERATOR_PASSWORD_HASH ?? ""))
          throw new AppError("Reauthentication required", 401);
        return reply(await approveBatch(actor, batchId, reviewDigest));
      }
      if (operation === "execute") {
        const { nonce, attemptId } = z
          .object({
            nonce: z.string().uuid(),
            attemptId: z.string().uuid().optional(),
          })
          .parse(body);
        return reply(
          await executeBatch(actor, batchId, nonce, provider(), attemptId),
        );
      }
      if (operation === "reconcile")
        return reply(await reconcileBatch(actor, batchId));
      if (operation === "otp") {
        const { paymentId, otp, password } = z
          .object({
            paymentId: z.string().uuid(),
            otp: z.string().regex(/^\d{4,10}$/),
            password: z.string().max(256),
          })
          .parse(body);
        const token = await login(password);
        await logout(
          new Request(req.url, { headers: { cookie: `ha_session=${token}` } }),
        );
        return reply(await finalizeOTP(actor, batchId, paymentId, otp));
      }
    }
    throw new AppError("Route not found", 404);
  } catch (e) {
    if (e instanceof AppError) return reply({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return reply(
        {
          error: "Invalid request parameters",
          issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    if (e instanceof SyntaxError) return reply({ error: "Invalid JSON" }, 400);
    console.error(
      "Request failed:",
      e instanceof Error ? e.name : "UnknownError",
    );
    return reply(
      {
        error:
          "Service unavailable. Check server configuration and retry read-only verification.",
      },
      503,
    );
  }
}
export { handle as GET, handle as POST, handle as DELETE };
