import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConfiguredModel,
  PRODUCT_KNOWLEDGE,
} from "../../src/lib/financial-agent";
import { setup } from "./helpers";

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
  it.each(["openai", "gemini"])(
    "sends reviewed knowledge only to product selection through %s (mocked HTTP)",
    async (provider) => {
      const outputs = [{ route: "product" }, { topic: "data" }];
      const prompts: { task: string; data: Record<string, unknown> }[] = [];
      const request = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const prompt =
          provider === "openai"
            ? body.messages[1].content
            : body.contents[0].parts[0].text;
        prompts.push(JSON.parse(prompt));
        const output = outputs.shift();
        return provider === "openai"
          ? openai(output)
          : new Response(
              JSON.stringify({
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: JSON.stringify(output) }] },
                  },
                ],
              }),
            );
      });
      vi.stubGlobal("fetch", request);
      const s = setup(
        createConfiguredModel({
          AI_PROVIDER: provider,
          AI_API_KEY: "test-only",
        }),
      );
      const text = "What does AGUS document about bank data connections?";
      const result = await s.agent().turn({ ...s.input, accountIds: [], text });
      expect(prompts.map((p) => p.task)).toEqual(["classify", "product"]);
      expect(prompts[0].data).not.toHaveProperty("knowledge");
      expect(prompts[1].data).toEqual({ text, knowledge: PRODUCT_KNOWLEDGE });
      expect(result.kind).toBe("product");
      expect(result.text).toContain(PRODUCT_KNOWLEDGE.entries.data);
      expect(result.evidence.toolCalls).toBe(0);
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
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
