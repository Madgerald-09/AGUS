import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredModel } from "../../src/lib/financial-agent";

afterEach(() => vi.unstubAllGlobals());
const signal = () => AbortSignal.timeout(1000);
const openai = (content: unknown, finish_reason = "stop") =>
  new Response(
    JSON.stringify({
      choices: [
        { finish_reason, message: { content: JSON.stringify(content) } },
      ],
    }),
  );
describe("bounded provider adapter (HTTP mocked only in these unit tests)", () => {
  it("reports missing model configuration without HTTP", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      createConfiguredModel({ AI_PROVIDER: "none" }).generate(
        "classify",
        {},
        signal(),
      ),
    ).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves configured provider/model and external AbortSignal", async () => {
    const request = vi.fn(async () => openai({ route: "general" }));
    vi.stubGlobal("fetch", request);
    const model = createConfiguredModel({
      AI_PROVIDER: "openai",
      AI_MODEL: "gpt-4.1-mini",
      AI_API_KEY: "test-only",
    });
    const s = signal();
    expect(await model.generate("classify", { text: "Hi" }, s)).toEqual({
      route: "general",
    });
    const [url, init] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.signal).toBe(s);
    expect(JSON.parse(String(init.body)).model).toBe("gpt-4.1-mini");
    expect(JSON.parse(String(init.body)).messages[0].role).toBe("system");
  });
  it("supports Gemini structured output and excludes thought parts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [
                      { thought: true, text: "not JSON" },
                      { text: '{"route":"general"}' },
                    ],
                  },
                },
              ],
            }),
          ),
      ),
    );
    const model = createConfiguredModel({
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-2.5-flash",
      AI_API_KEY: "test-only",
    });
    expect(await model.generate("classify", {}, signal())).toEqual({
      route: "general",
    });
  });
  it.each([400, 401, 429, 503])(
    "does not implicitly retry HTTP %s or disclose provider errors",
    async (status) => {
      const request = vi.fn(
        async () => new Response("secret provider response", { status }),
      );
      vi.stubGlobal("fetch", request);
      const model = createConfiguredModel({
        AI_PROVIDER: "gemini",
        AI_API_KEY: "test-only",
      });
      await expect(
        model.generate("classify", {}, signal()),
      ).rejects.toMatchObject({ code: `MODEL_HTTP_${status}` });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["length", "content_filter", "tool_calls"])(
    "rejects incomplete or function completion: %s",
    async (reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => openai({ route: "general" }, reason)),
      );
      await expect(
        createConfiguredModel({
          AI_PROVIDER: "openai",
          AI_API_KEY: "test-only",
        }).generate("classify", {}, signal()),
      ).rejects.toMatchObject({ code: "MODEL_COMPLETION" });
    },
  );
  it("rejects schema extra keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openai({ route: "general", actorId: "spoof" })),
    );
    await expect(
      createConfiguredModel({
        AI_PROVIDER: "openai",
        AI_API_KEY: "test-only",
      }).generate("classify", {}, signal()),
    ).rejects.toThrow();
  });
  it("bounds envelope consumption to sixty-four KiB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(65537))),
    );
    await expect(
      createConfiguredModel({
        AI_PROVIDER: "openai",
        AI_API_KEY: "test-only",
      }).generate("classify", {}, signal()),
    ).rejects.toMatchObject({ code: "MODEL_BYTES" });
  });
  it("rejects Gemini blocked or function-call envelopes", async () => {
    const model = createConfiguredModel({
      AI_PROVIDER: "gemini",
      AI_API_KEY: "test-only",
    });
    for (const raw of [
      { promptFeedback: { blockReason: "SAFETY" } },
      {
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ functionCall: { name: "submit_payment" } }] },
          },
        ],
      },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(raw))),
      );
      await expect(
        model.generate("classify", {}, signal()),
      ).rejects.toMatchObject({ code: "MODEL_COMPLETION" });
    }
  });
});
