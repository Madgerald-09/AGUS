"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AgentReply } from "@/lib/financial-agent";

type Turn = { text: string; reply: AgentReply };
type Account = { accountId: string; displayName: string; maskedNumber: string };
export function FinancialConversation() {
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountError, setAccountError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    // Only the opaque ID is retained in this tab; no transcript or account data.
    const saved =
      sessionStorage.getItem("agus-conversation-id") || crypto.randomUUID();
    sessionStorage.setItem("agus-conversation-id", saved);
    setId(saved);
  }, []);
  async function loadAccounts() {
    setAccountError("");
    try {
      const response = await fetch("/api/financial-agent", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.code || "ACCOUNTS_UNAVAILABLE");
      setAccounts(data.accounts);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "ACCOUNTS_UNAVAILABLE");
    }
  }
  async function send() {
    if (pending.current || !id || !text.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const original = text;
    try {
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: id,
          text: original,
          accountIds: account ? [account] : [],
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.reply?.evidence?.code ||
            data.error?.code ||
            "CONVERSATION_UNAVAILABLE",
        );
      setTurns((previous) => [
        ...previous,
        { text: original, reply: data.reply },
      ]);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "CONVERSATION_UNAVAILABLE");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function draft(original: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      // Explicit intent handoff of the original request. The existing workflow
      // extracts editable details and retains verification/review/approval gates.
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: original }),
      });
      if (!response.ok) throw new Error("DRAFT_UNAVAILABLE");
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "DRAFT_UNAVAILABLE");
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <Link href="/">Back to payment workspace / sign in</Link>
      <h1>AGUS conversation</h1>
      <p>SIMULATED FICTIONAL DATA · No real banking or money movement.</p>
      <p>
        Sign in through the payment workspace first. General financial education
        needs no account. Personal answers use authorized fictional records.
      </p>
      <button disabled={busy} onClick={() => void loadAccounts()}>
        Load authorized accounts
      </button>
      <label>
        Account (optional)
        <select
          aria-label="Account (optional)"
          value={account}
          disabled={busy}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">No account</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>
              {a.displayName} {a.maskedNumber}
            </option>
          ))}
        </select>
      </label>
      {accountError && (
        <p role="alert">
          Accounts unavailable: {accountError}. Education can still be
          requested.
        </p>
      )}
      <button
        disabled={busy || !id}
        onClick={() => {
          const next = crypto.randomUUID();
          sessionStorage.setItem("agus-conversation-id", next);
          setId(next);
          setTurns([]);
          setError("");
        }}
      >
        New conversation
      </button>
      <p>
        Follow-up context lasts 15 minutes. Reload keeps this tab’s conversation
        context; the visible transcript starts fresh.
      </p>
      <section aria-label="Conversation replies" aria-live="polite">
        {turns.map((turn, i) => (
          <article key={i}>
            <p>
              <strong>You:</strong> {turn.text}
            </p>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              <strong>AGUS:</strong> {turn.reply.text}
            </p>
            {turn.reply.handoff && (
              <button disabled={busy} onClick={() => void draft(turn.text)}>
                Continue in payment draft
              </button>
            )}
          </article>
        ))}
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="financial-message">Message</label>
        <textarea
          id="financial-message"
          value={text}
          maxLength={4000}
          rows={4}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
        <button disabled={busy || !id || !text.trim()}>
          {busy ? "Working…" : "Send message"}
        </button>
      </form>
      {error && (
        <p role="alert">
          Request unavailable: {error}. Your input is preserved. For a context
          conflict or expiry, start a new conversation.
        </p>
      )}
      <p>
        Payment preparation opens an editable draft. Verification, review,
        password approval and explicit submission stay in the payment workspace.
      </p>
    </main>
  );
}
