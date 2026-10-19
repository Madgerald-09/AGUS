import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../src/app/page";

afterEach(() => vi.unstubAllEnvs());
it.each([
  ["fixture", "local fixture simulation", "Demo Access"],
  ["test", "Paystack test mode", "Test Access"],
  ["live", "Transfers can move real funds", "Live Access"],
])(
  "discloses server mode %s without credentials",
  async (mode, disclosure, label) => {
    vi.stubEnv("PAYMENT_MODE", mode);
    vi.stubEnv("PAYSTACK_SECRET_KEY", "private-payment-key");
    vi.stubEnv("AI_API_KEY", "private-model-key");
    vi.stubEnv("LIVE_TRANSFERS_ENABLED", "false");
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain(disclosure);
    expect(html).toContain(label);
    expect(html).not.toContain("private-payment-key");
    expect(html).not.toContain("private-model-key");
    if (mode !== "fixture") {
      expect(html).not.toContain("fixture simulation");
      expect(html).not.toContain("Fixture experience");
    }
    if (mode === "live") expect(html).not.toContain("No real funds move");
  },
);
