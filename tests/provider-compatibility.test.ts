import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modelPlan, chat } from "../src/lib/intelligence";
import { mutate, readState } from "../src/lib/db";
import { seedState } from "../src/lib/domain";
import { Paystack } from "../src/lib/paystack";

const plan = {
  intent: "conversation",
  payments: [],
  period: "all",
  category: null,
};
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_MODEL", "gemini-3.5-flash-lite");
  vi.stubEnv("AI_API_KEY", "synthetic-private-key");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the configured 3.5 model and validates only final answer text across parts", async () => {
  const json = JSON.stringify(plan);
  const transport = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { text: "private thought: synthetic-private-key", thought: true },
              { thoughtSignature: "private-signature" },
              { text: json.slice(0, 20) },
              { text: json.slice(20), thoughtSignature: "private-signature" },
            ],
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", transport);
  await expect(modelPlan("Hey", {})).resolves.toEqual(plan);
  const [url, init] = (
    transport.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toContain("gemini-3.5-flash-lite:generateContent");
  const schema = JSON.parse(init.body as string).generationConfig
    .responseJsonSchema;
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.payments.maxItems).toBe(10);
  expect(schema.properties.payments.items.additionalProperties).toBe(false);
  expect(log).not.toHaveBeenCalled();
});

const candidate = (text: string, finishReason = "STOP") => ({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
});
it.each([
  ["completion", { candidates: [] }],
  ["completion", { promptFeedback: { blockReason: "synthetic-private-key" } }],
  ["completion", candidate(JSON.stringify(plan), "MAX_TOKENS")],
  ["completion", candidate(JSON.stringify(plan), "SAFETY")],
  ["envelope", { candidates: "synthetic-private-key" }],
  [
    "text",
    {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ thought: true, text: "synthetic-private-key" }],
          },
        },
      ],
    },
  ],
  ["json", candidate("synthetic-private-key malformed JSON")],
  [
    "schema",
    candidate(JSON.stringify({ ...plan, intent: "synthetic-private-key" })),
  ],
  [
    "schema",
    candidate(JSON.stringify({ ...plan, execute: "synthetic-private-key" })),
  ],
  [
    "schema",
    candidate(
      JSON.stringify({
        ...plan,
        payments: [{ name: "synthetic-private-key", amountNaira: 500 }],
      }),
    ),
  ],
])(
  "rejects %s failures safely without retry or persisted side effects",
  async (stage, body) => {
    await mutate((s) => Object.assign(s, seedState()));
    const before = structuredClone(await readState());
    const transport = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", transport);
    await expect(chat("operator", "Hey")).rejects.toMatchObject({
      status: 502,
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(await readState()).toEqual(before);
    expect(log).toHaveBeenCalledWith(
      "AI response rejected",
      expect.objectContaining({
        stage,
        model: "gemini-3.5-flash-lite",
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "synthetic-private-key",
    );
  },
);

const bankA = { name: "Wema Bank", code: "035" };
const bankB = { name: "Access Bank", code: "044" };
function bankProvider(pages: unknown[]) {
  const transport = vi.fn();
  for (const page of pages)
    transport.mockResolvedValueOnce(Response.json(page));
  return {
    transport,
    provider: new Paystack("test", "sk_test_synthetic", transport),
  };
}
const page = (data: unknown[], next?: unknown) => ({
  status: true,
  data,
  meta: { next },
});

it("follows encoded cursor metadata even on short pages and deduplicates bank codes", async () => {
  const { transport, provider } = bankProvider([
    page([bankA], "cursor+/=&?"),
    page([bankA, bankB], null),
  ]);
  await expect(provider.banks()).resolves.toEqual([bankA, bankB]);
  expect(transport).toHaveBeenCalledTimes(2);
  const first = new URL(transport.mock.calls[0][0]);
  expect(first.searchParams.get("use_cursor")).toBe("true");
  expect(first.searchParams.get("country")).toBe("nigeria");
  expect(first.searchParams.get("currency")).toBe("NGN");
  expect(first.searchParams.has("page")).toBe(false);
  expect(new URL(transport.mock.calls[1][0]).searchParams.get("next")).toBe(
    "cursor+/=&?",
  );
});

it.each([undefined, null, "", "null"])(
  "stops on a terminal cursor %s regardless of page size",
  async (next) => {
    const banks = Array.from({ length: 100 }, (_, i) => ({
      name: `Bank ${i}`,
      code: `${i}`,
    }));
    const { provider, transport } = bankProvider([page(banks, next)]);
    await expect(provider.banks()).resolves.toEqual(banks);
    expect(transport).toHaveBeenCalledOnce();
  },
);

it("accepts an unpaginated envelope and returns no duplicates", async () => {
  const { provider, transport } = bankProvider([
    { status: true, data: [bankA, bankA] },
  ]);
  await expect(provider.banks()).resolves.toEqual([bankA]);
  expect(transport).toHaveBeenCalledOnce();
});

it.each([
  [page([bankA], "a"), page([bankB], "a")],
  [page([bankA], "a"), page([bankA], "b")],
  [page([bankA], "a"), page([], "b")],
  [
    page([bankA], "a"),
    page([bankB], "b"),
    page([{ name: "Third", code: "058" }], "a"),
  ],
])(
  "fails closed on repeated/cyclic cursors and pages without progress",
  async (...pages) => {
    const { provider, transport } = bankProvider(pages);
    await expect(provider.banks()).rejects.toMatchObject({ status: 502 });
    expect(transport).toHaveBeenCalledTimes(pages.length);
  },
);

it("bounds pagination at 20 requests", async () => {
  const { provider, transport } = bankProvider(
    Array.from({ length: 20 }, (_, i) =>
      page([{ name: `Bank ${i}`, code: `${i}` }], `cursor${i}`),
    ),
  );
  await expect(provider.banks()).rejects.toThrow("pagination limit");
  expect(transport).toHaveBeenCalledTimes(20);
});

it.each([
  page([bankA], 123),
  page([bankA], { token: "bad" }),
  { status: false, message: "Rejected" },
  { status: true, data: [{ name: "Bad" }] },
])("rejects malformed or rejected bank responses", async (body) => {
  const { provider, transport } = bankProvider([body]);
  await expect(provider.banks()).rejects.toMatchObject({ status: 502 });
  expect(transport).toHaveBeenCalledOnce();
});
