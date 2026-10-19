import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { transcribeAudio } from "../src/lib/intelligence";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_API_KEY", "synthetic-transcription-key");
  vi.stubEnv("AI_MODEL", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("sends recorded audio to OpenAI transcription and returns the verbatim transcript", async () => {
  const transport = vi.fn(async () =>
    Response.json({ text: "Pay ₦50,000 to Acme Supplies" }),
  );
  vi.stubGlobal("fetch", transport);

  await expect(
    transcribeAudio(Buffer.from([1, 2, 3]), "audio/webm"),
  ).resolves.toBe("Pay ₦50,000 to Acme Supplies");

  const [url, init] = (
    transport.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
  expect(init.headers).toEqual({
    Authorization: "Bearer synthetic-transcription-key",
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const form = init.body as FormData;
  expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
  expect(form.get("prompt")).toContain("Preserve business names");
  const file = form.get("file");
  expect(file).toBeInstanceOf(Blob);
  if (!(file instanceof Blob)) throw new Error("Audio file was not uploaded");
  expect(file.type).toBe("audio/webm");
  expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([
    1, 2, 3,
  ]);
});

it("sends audio as inline data to the configured Gemini model", async () => {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_MODEL", "gemini-2.5-flash");
  const transport = vi.fn(async () =>
    Response.json({
      candidates: [{ content: { parts: [{ text: "Invoice due Friday" }] } }],
    }),
  );
  vi.stubGlobal("fetch", transport);

  await expect(
    transcribeAudio(Buffer.from([1, 2, 3]), "audio/mp4"),
  ).resolves.toBe("Invoice due Friday");

  const [url, init] = (
    transport.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  );
  const body = JSON.parse(init.body as string);
  expect(body.contents[0].parts[1]).toEqual({
    inlineData: {
      mimeType: "audio/mp4",
      data: Buffer.from([1, 2, 3]).toString("base64"),
    },
  });
});

it("rejects an empty transcript instead of passing a guessed voice request to chat", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ text: "   " })),
  );

  await expect(
    transcribeAudio(Buffer.from([1, 2, 3]), "audio/webm"),
  ).rejects.toThrow("No clear speech was detected");
});
