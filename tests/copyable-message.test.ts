import { afterEach, expect, it, vi } from "vitest";
import { messagePlainText } from "../src/components/copyable-message";
// Intentionally optimistic geometry: reproduce DOM implementations where closed
// details descendants still have rects. Browser geometry is tested separately.
class Element {
  nodeType = 1;
  childNodes: (Element | { nodeType: number; textContent: string })[];
  constructor(
    public tagName: string,
    children: (Element | string)[] = [],
    public attrs: Record<string, string | undefined> = {},
  ) {
    this.childNodes = children.map((child) =>
      typeof child === "string" ? { nodeType: 3, textContent: child } : child,
    );
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  getClientRects() {
    return [{}];
  }
  matches(selectors: string) {
    return selectors
      .split(", ")
      .some((s) =>
        s.startsWith(".")
          ? this.attrs.class === s.slice(1)
          : s.startsWith("[")
            ? this.hasAttribute(s.slice(1, -1))
            : this.tagName.toLowerCase() === s,
      );
  }
}
function copy(root: Element) {
  vi.stubGlobal("Node", { TEXT_NODE: 3 });
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("window", {
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
    }),
  });
  return messagePlainText(root as unknown as HTMLElement);
}
afterEach(() => vi.unstubAllGlobals());
it("excludes closed bodies even with visible synthetic geometry", () => {
  expect(
    copy(
      new Element("DIV", [
        new Element("P", ["Visible", new Element("BR"), "Next line"]),
        new Element("DETAILS", [
          new Element("SUMMARY", ["More"]),
          "PRIVATE-CLOSED-BODY",
        ]),
      ]),
    ),
  ).toBe("Visible\nNext line");
});
it("copies expanded prose while excluding nested closed disclosures", () => {
  expect(
    copy(
      new Element("DIV", [
        new Element(
          "DETAILS",
          [
            new Element("SUMMARY", ["More"]),
            new Element("P", ["Expanded text"]),
            new Element("DETAILS", ["NESTED-CLOSED"]),
            new Element("DETAILS", [new Element("P", ["Nested expanded"])], {
              open: "",
            }),
          ],
          { open: "" },
        ),
      ]),
    ),
  ).toBe("Expanded text\nNested expanded");
});
it.each([
  { hidden: "" },
  { "data-copy-exclude": "" },
  { "data-redacted": "" },
  { class: "agus-sources" },
  { class: "batch-card" },
  { class: "payment-editor" },
])("excludes hidden metadata, redactions and payment internals %j", (attrs) => {
  expect(
    copy(
      new Element("DIV", [
        "Visible",
        new Element("DIV", ["FICTIONAL-PRIVATE"], attrs),
      ]),
    ),
  ).toBe("Visible");
});
