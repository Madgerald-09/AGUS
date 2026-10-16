import { z } from "zod";
import { AppError } from "./domain";

type Stage = "envelope" | "completion" | "text" | "json" | "schema";

// Never log provider bodies, Zod messages/inputs, thought text or signatures.
// Even finish reasons and block reasons can contain arbitrary provider text.
export function responseFailure(
  provider: string,
  model: string,
  stage: Stage,
  issues: z.core.$ZodIssue[] = [],
): never {
  console.error("AI response rejected", {
    provider,
    model: /^(gemini-|gpt-)[a-z0-9.-]{1,80}$/.test(model)
      ? model
      : "custom-model",
    operation: "generate-plan",
    stage,
    issueCount: issues.length,
    issueCodes: [...new Set(issues.map((issue) => issue.code))].slice(0, 10),
  });
  throw new AppError(
    `AI response could not be validated (${stage}). Your input is preserved.`,
    502,
  );
}

export async function modelResponse<T>(
  response: Response,
  provider: "gemini" | "openai",
  model: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const fail = (stage: Stage, issues?: z.core.$ZodIssue[]): never =>
    responseFailure(provider, model, stage, issues);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return fail("envelope");
  }
  let output: string;
  if (provider === "gemini") {
    const envelope = z
      .object({
        promptFeedback: z
          .object({ blockReason: z.string().optional() })
          .optional(),
        candidates: z
          .array(
            z.object({
              finishReason: z.string().optional(),
              content: z
                .object({
                  parts: z.array(
                    z.object({
                      text: z.string().optional(),
                      thought: z.boolean().optional(),
                    }),
                  ),
                })
                .optional(),
            }),
          )
          .optional(),
      })
      .safeParse(raw);
    if (!envelope.success) return fail("envelope", envelope.error.issues);
    const candidate = envelope.data.candidates?.[0];
    if (
      envelope.data.promptFeedback?.blockReason ||
      !candidate ||
      (candidate.finishReason !== undefined &&
        candidate.finishReason !== "STOP")
    )
      return fail("completion");
    // Metadata-only parts and thought summaries are not answer JSON. Never
    // concatenate candidates or execute function calls returned by a model.
    output =
      candidate.content?.parts
        .filter((part) => part.thought !== true && part.text !== undefined)
        .map((part) => part.text)
        .join("") ?? "";
  } else {
    const envelope = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string().optional(),
              message: z.object({ content: z.string() }),
            }),
          )
          .min(1),
      })
      .safeParse(raw);
    if (!envelope.success) return fail("envelope", envelope.error.issues);
    const candidate = envelope.data.choices[0];
    if (
      candidate.finish_reason !== undefined &&
      candidate.finish_reason !== "stop"
    )
      return fail("completion");
    output = candidate.message.content;
  }
  if (!output.trim()) return fail("text");
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return fail("json");
  }
  const plan = schema.safeParse(value);
  if (!plan.success) return fail("schema", plan.error.issues);
  return plan.data;
}
