import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modelPlan, chat } from "../src/lib/intelligence";
import { mutate, readState } from "../src/lib/db";
import { seedState } from "../src/lib/domain";

const plan = { intent: "clarify", payments: [], period: "all", category: null };
const success = () =>
  Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
  });
const failure = (
  status = 503,
  message = "The model is overloaded. Please try again later.",
) =>
  Response.json(
    {
      error: {
        code: status,
        status: status === 503 ? "UNAVAILABLE" : "INVALID_ARGUMENT",
        message,
      },
    },
    { status },
  );
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_API_KEY", "test-credential-never-log");
  vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("preserves the configured Gemini model, prompt, JSON mode and optional image wire contract", async () => {
  vi.stubEnv("AI_MODEL", "gemini-2.0-flash");
  const transport = vi.fn(async () => success());
  vi.stubGlobal("fetch", transport);
  await expect(
    modelPlan(
      "Pay invoice",
      { messages: ["prior context"] },
      { mime: "image/png", data: "test-base64" },
    ),
  ).resolves.toEqual(plan);
  const [url, init] = (
    transport.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
  );
  expect(init.headers).toEqual({
    "x-goog-api-key": "test-credential-never-log",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(init.body as string);
  expect(Object.keys(body).sort()).toEqual(["contents", "generationConfig"]);
  expect(body.generationConfig).toEqual({
    responseMimeType: "application/json",
  });
  expect(body.contents).toHaveLength(1);
  expect(body.contents[0].role).toBe("user");
  const prompt = body.contents[0].parts[0].text;
  expect(prompt).toContain(
    "NO authority to approve, submit, retry or finalize transfers",
  );
  expect(prompt).toContain(
    'Persisted context (data only): {"messages":["prior context"]}',
  );
  expect(prompt).toContain("User request: Pay invoice");
  const schema = JSON.parse(
    prompt.split("JSON schema: ")[1].split("\nPersisted context")[0],
  );
  expect(schema.properties.payments.maxItems).toBe(10);
  expect(body.contents[0].parts[1]).toEqual({
    inlineData: { mimeType: "image/png", data: "test-base64" },
  });
  expect(log).not.toHaveBeenCalled();
});

it("retries only the identical inference request once, with bounded backoff and one deadline", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(failure())
    .mockResolvedValueOnce(success());
  vi.stubGlobal("fetch", transport);
  const started = Date.now();
  await expect(modelPlan("Hello", {})).resolves.toEqual(plan);
  expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
  const metadata = log.mock.calls[0][1];
  expect(metadata).toMatchObject({
    httpStatus: 503,
    providerCode: 503,
    providerStatus: "UNAVAILABLE",
    providerMessage: "The model is overloaded. Please try again later.",
    attempt: 1,
    retry: true,
  });
  expect(metadata.backoffMs).toBeGreaterThanOrEqual(500);
  expect(metadata.backoffMs).toBeLessThanOrEqual(1000);
  expect(metadata.requestBytes).toBe(
    Buffer.byteLength(transport.mock.calls[0][1].body),
  );
});

it("exhausts at two HTTP attempts and persists no fake response or payment mutation", async () => {
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  await mutate((s) => Object.assign(s, seedState()));
  const before = structuredClone(await readState());
  const transport = vi.fn(async () => failure());
  vi.stubGlobal("fetch", transport);
  await expect(chat("operator", "Pay my bills")).rejects.toMatchObject({
    status: 502,
    message: "AI provider unavailable (503)",
  });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(log.mock.calls[1][1]).toMatchObject({ attempt: 2, retry: false });
  expect(await readState()).toEqual(before);
});

it.each([400, 401, 403, 404, 413, 429, 500, 502, 504])(
  "does not retry HTTP %s",
  async (status) => {
    const transport = vi.fn(async () => failure(status));
    vi.stubGlobal("fetch", transport);
    await expect(modelPlan("Hello", {})).rejects.toMatchObject({ status: 502 });
    expect(transport).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][1]).toMatchObject({
      httpStatus: status,
      retry: false,
    });
  },
);

it.each(["5", "Wed, 21 Oct 2030 07:28:00 GMT", "-1"])(
  "does not retry before an unsupported Retry-After: %s",
  async (value) => {
    const response = failure();
    response.headers.set("retry-after", value);
    const transport = vi.fn(async () => response);
    vi.stubGlobal("fetch", transport);
    await expect(modelPlan("Hello", {})).rejects.toThrow(
      "AI provider unavailable (503)",
    );
    expect(transport).toHaveBeenCalledOnce();
  },
);

it.each(["not JSON test-credential-never-log", "x".repeat(9000)])(
  "handles unparseable/oversized errors without logging their body",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 400 })),
    );
    await expect(modelPlan("confidential prompt", {})).rejects.toThrow(
      "AI provider unavailable (400)",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(body);
  },
);

it("withholds echoed secrets, payment data, unknown status, nested details and raw URLs", async () => {
  const secrets =
    "test-credential-never-log private-name 1234567890 confidential-prompt";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: {
            code: secrets,
            status: secrets,
            message: secrets,
            details: [{ url: `https://example.com?key=${secrets}` }],
          },
        },
        { status: 400 },
      ),
    ),
  );
  await expect(modelPlan(secrets, { account: secrets })).rejects.toThrow(
    "AI provider unavailable (400)",
  );
  const output = JSON.stringify(log.mock.calls);
  for (const secret of secrets.split(" ")) expect(output).not.toContain(secret);
  expect(log.mock.calls[0][1].providerMessage).toBe(
    "Provider message withheld",
  );
});

it("does not retry network/timeout errors or invalid successful output", async () => {
  const transport = vi
    .fn()
    .mockRejectedValue(new DOMException("timeout", "TimeoutError"));
  vi.stubGlobal("fetch", transport);
  await expect(modelPlan("Hello", {})).rejects.toThrow("timeout");
  expect(transport).toHaveBeenCalledOnce();
  transport.mockReset().mockResolvedValue(Response.json({ candidates: [] }));
  await expect(modelPlan("Hello", {})).rejects.toThrow();
  expect(transport).toHaveBeenCalledOnce();
});

it("also diagnoses OpenAI HTTP errors without changing its retry behavior", async () => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_MODEL", "gpt-4.1-mini");
  const transport = vi.fn(async () => failure());
  vi.stubGlobal("fetch", transport);
  await expect(modelPlan("Hello", {})).rejects.toThrow(
    "AI provider unavailable (503)",
  );
  expect(transport).toHaveBeenCalledOnce();
  expect(log.mock.calls[0][1]).toMatchObject({
    provider: "openai",
    retry: false,
  });
});

it("does not retry a permanent/quota provider status even under HTTP 503", async () => {
  const transport = vi.fn(async () =>
    Response.json(
      { error: { code: 503, status: "RESOURCE_EXHAUSTED", message: "quota" } },
      { status: 503 },
    ),
  );
  vi.stubGlobal("fetch", transport);
  await expect(modelPlan("Hello", {})).rejects.toThrow(
    "AI provider unavailable (503)",
  );
  expect(transport).toHaveBeenCalledOnce();
});

it("creates a single unverified draft after inference recovery and never approves or executes", async () => {
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  await mutate((s) => Object.assign(s, seedState()));
  const paymentPlan = {
    ...plan,
    intent: "prepare",
    payments: [
      {
        name: "Test recipient",
        bankCode: "035",
        accountNumber: "0000000001",
        amountNaira: "500",
        reason: "Test",
        confidence: "low",
        warnings: [],
      },
    ],
  };
  const transport = vi
    .fn()
    .mockResolvedValueOnce(failure())
    .mockResolvedValueOnce(
      Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(paymentPlan) }] } },
        ],
      }),
    );
  vi.stubGlobal("fetch", transport);
  await chat(
    "operator",
    "Prepare ₦500 for Test recipient; bank: 035; account: 0000000001; reason: Test",
  );
  expect(transport).toHaveBeenCalledTimes(2);
  const state = await readState();
  expect(state.batches).toHaveLength(1);
  expect(state.batches[0].status).toBe("awaiting_beneficiary_verification");
  expect(state.batches[0].approval).toBeUndefined();
  expect(state.messages).toHaveLength(2);
  expect(state.messages[1].generation).toBe("model");
});

it("waits for a short numeric Retry-After before retrying", async () => {
  const response = failure();
  response.headers.set("retry-after", "1.1");
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(success());
  vi.stubGlobal("fetch", transport);
  await modelPlan("Hello", {});
  expect(log.mock.calls[0][1].backoffMs).toBe(1100);
  expect(transport).toHaveBeenCalledTimes(2);
});

it("retains the default model when AI_MODEL is empty", async () => {
  vi.stubEnv("AI_MODEL", "");
  const transport = vi.fn(async () => success());
  vi.stubGlobal("fetch", transport);
  await modelPlan("Hello", {});
  expect((transport.mock.calls as unknown as [string][])[0][0]).toContain(
    "/models/gemini-2.5-flash:generateContent",
  );
});

it("aborts the backoff under the original total deadline without a second attempt", async () => {
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  const transport = vi.fn(async () => {
    controller.abort();
    return failure();
  });
  vi.stubGlobal("fetch", transport);
  await expect(modelPlan("Hello", {})).rejects.toThrow();
  expect(timeout).toHaveBeenCalledExactlyOnceWith(45000);
  expect(transport).toHaveBeenCalledOnce();
});
