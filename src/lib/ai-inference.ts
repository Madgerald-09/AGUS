import { AppError } from "./domain";
import { setTimeout as delay } from "node:timers/promises";

// Provider messages can echo prompts, account details or credentials. Only these
// exact public service messages are safe to retain; never log arbitrary text.
const safeMessages = new Set([
  "The model is overloaded. Please try again later.",
  "The service is currently unavailable.",
  "Service unavailable.",
]);
const safeStatuses = new Set([
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "OUT_OF_RANGE",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "CANCELLED",
  "UNKNOWN",
  "INTERNAL",
  "UNIMPLEMENTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
]);

async function providerError(response: Response) {
  // Bound diagnostic reads as well as log output. Ignore HTML, malformed JSON,
  // nested details and oversized bodies rather than leaking raw provider data.
  const reader = response.body?.getReader();
  if (!reader) return {};
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) return {};
      chunks.push(value);
    }
    const error = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error;
    return {
      providerCode:
        Number.isInteger(error?.code) && error.code >= 100 && error.code <= 599
          ? error.code
          : undefined,
      providerStatus: safeStatuses.has(error?.status)
        ? error.status
        : undefined,
      providerMessage: safeMessages.has(error?.message)
        ? error.message
        : "Provider message withheld",
    };
  } catch {
    return {};
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// For model inference only. Never wrap chat(), tools, draft creation or payment
// execution in this retry: downstream mutations must run at most once.
export async function inferenceRequest(
  provider: "gemini" | "openai",
  model: string,
  url: string,
  headers: Record<string, string>,
  body: string,
) {
  // One total deadline covers both attempts, backoff and response consumption.
  const signal = AbortSignal.timeout(45000);
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
    });
    if (response.ok) return response;
    const details = await providerError(response);
    const retryAfter = response.headers.get("retry-after");
    const requestedDelay =
      retryAfter === null ? null : Number(retryAfter) * 1000;
    // Respect short numeric Retry-After values; do not retry early when the
    // provider asks for a longer/unknown delay. No retries for quota or 4xx.
    const retry =
      provider === "gemini" &&
      response.status === 503 &&
      attempt === 1 &&
      (!details.providerStatus || details.providerStatus === "UNAVAILABLE") &&
      (requestedDelay === null ||
        (Number.isFinite(requestedDelay) &&
          requestedDelay >= 0 &&
          requestedDelay <= 2000));
    const backoffMs = retry
      ? Math.max(500 + Math.floor(Math.random() * 501), requestedDelay ?? 0)
      : 0;
    console.error("AI provider HTTP error", {
      provider,
      // Only recognized model identifier syntax; never log URLs or headers.
      model: /^(gemini-|gpt-)[a-z0-9.-]{1,80}$/.test(model)
        ? model
        : "custom-model",
      operation: "generate-plan",
      httpStatus: response.status,
      ...details,
      requestBytes: Buffer.byteLength(body, "utf8"),
      responseMimeType: "application/json",
      attempt,
      retry,
      backoffMs,
    });
    if (!retry)
      throw new AppError(`AI provider unavailable (${response.status})`, 502);
    await delay(backoffMs, undefined, { signal });
  }
}
