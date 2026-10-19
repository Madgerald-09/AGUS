/** End-to-end adapter/tool/narration wiring with MOCKED Gemini HTTP only. */
import { afterEach, expect, it, vi } from "vitest";
import { createConfiguredModel } from "../../src/lib/financial-agent";
import { calc, setup } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

it.each(["accepted", "invented-claim", "revoked"] as const)(
  "sends concrete validated examples to Gemini and preserves the financial boundary: %s (HTTP mocked)",
  async (outcome) => {
    const tasks: string[] = [];
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const { task, data } = JSON.parse(body.contents[0].parts[0].text);
      tasks.push(task);
      let output;
      if (task === "classify") output = { route: "financial_read" };
      else if (task === "plan")
        output = data.results.length
          ? {
              kind: "respond",
              resultIds: data.results.map(
                (r: { resultId: string }) => r.resultId,
              ),
            }
          : calc;
      else {
        expect(task).toBe("narrate");
        expect(body.generationConfig.responseMimeType).toBe("application/json");
        expect(body.generationConfig.responseJsonSchema.required).toContain(
          "paragraphs",
        );
        const instructions = body.systemInstruction.parts[0].text;
        expect(instructions).toContain("authoring.examples");
        expect(instructions).toContain("Never copy currency amounts");
        expect(instructions).toContain("EVERY authoring.required");
        const examples = data.authoring.examples as {
          resultId: string;
          text: string;
        }[];
        const spending = examples.find((e) =>
          e.text.startsWith("Your total spending"),
        )!;
        const difference = examples.find((e) =>
          e.text.startsWith("The net difference"),
        )!;
        expect(spending.resultId).toBe(data.facts[0].resultId);
        expect(spending.text).toContain("{{r0.expenses}}");
        expect(spending.text).not.toMatch(/[₦\d],[\d,]+/);
        output = {
          paragraphs: [
            {
              resultIds: [spending.resultId],
              text: `${spending.text}\n${difference.text} ${data.authoring.required.map((t: string) => `${t}.`).join(" ")}${outcome === "invented-claim" ? " Your bank balance is {{r0.difference}}." : ""}`,
            },
          ],
        };
        if (outcome === "revoked")
          await s.repository.revokeConsent(
            s.input.ctx,
            "consent-amina",
            s.clock(),
          );
      }
      return new Response(
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
        AI_PROVIDER: "gemini",
        AI_MODEL: "configured-test-model",
        AI_API_KEY: "mock-only",
      }),
    );
    const reply = await s.agent().turn(s.input);
    expect(tasks).toEqual(["classify", "plan", "plan", "narrate"]);
    expect(request).toHaveBeenCalledTimes(4);
    expect(reply.evidence).toMatchObject({ modelCalls: 4, toolCalls: 1 });
    if (outcome === "revoked") {
      expect(reply.kind).toBe("unavailable");
      expect(reply.citations).toEqual([]);
      expect(reply.presentation).toBeUndefined();
      expect(reply.text).not.toContain("₦");
      expect(reply.evidence.narrationDiagnostic).toBeUndefined();
    } else {
      expect(reply.kind).toBe("financial");
      expect(reply.text).toContain("₦19,751.51");
      expect(reply.text).toContain("₦250,000.00");
      expect(reply.text).toContain("₦230,248.49");
      if (outcome === "accepted") {
        expect(reply.presentation?.narration).toBe("ai");
        expect(reply.presentation?.explanation[0]).toContain(
          "Your total spending was ₦19,751.51",
        );
        expect(reply.evidence.narrationCode).toBeUndefined();
      } else {
        expect(reply.presentation?.narration).toBe("factual_fallback");
        expect(reply.evidence).toMatchObject({
          narrationCode: "NARRATION_CLAIM",
          narrationDiagnostic: { category: "unsupported_structure" },
        });
        expect(reply.text).not.toContain("Your bank balance");
      }
    }
  },
);
