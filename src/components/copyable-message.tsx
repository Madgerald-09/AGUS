"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";

/** Read rendered prose only. Never inspect props, payment state or tool payloads.
 * Collapsed/hidden content and technical source disclosures are excluded. */
export function messagePlainText(root: HTMLElement): string {
  const blocks = new Set([
    "P",
    "DIV",
    "SECTION",
    "LI",
    "TR",
    "DT",
    "DD",
    "H1",
    "H2",
    "H3",
  ]);
  function read(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    if (
      node.matches(
        "button, input, select, textarea, summary, script, style, [hidden], [aria-hidden='true'], .agus-sources, .agus-sr-only",
      )
    )
      return "";
    const style = window.getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      !node.getClientRects().length
    )
      return "";
    const text = Array.from(node.childNodes, read).join("");
    return blocks.has(node.tagName) ? `${text}\n` : text;
  }
  return read(root)
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function CopyableMessage({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState("");
  const live = useRef(true);
  const copying = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);
  async function copy() {
    if (!content.current || copying.current) return;
    copying.current = true;
    try {
      const text = messagePlainText(content.current);
      if (!text || !navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (live.current) setFeedback("Copied");
    } catch {
      if (live.current)
        setFeedback(
          "Couldn’t copy. Select the message text and copy it manually.",
        );
    } finally {
      copying.current = false;
    }
  }
  return (
    <div className="agus-copyable">
      <div ref={content}>{children}</div>
      <button
        type="button"
        className="agus-icon-button agus-copy"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {feedback === "Copied" ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <span
        className={
          feedback && feedback !== "Copied"
            ? "agus-copy-feedback"
            : "agus-sr-only"
        }
        role="status"
      >
        {feedback}
      </span>
    </div>
  );
}
