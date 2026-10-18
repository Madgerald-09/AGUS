"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type { AgentReply } from "@/lib/financial-agent";
import type { SavedChat, SavedTurn } from "@/lib/chat-history/store";
import "./financial-conversation.css";

type Account = { accountId: string; displayName: string; maskedNumber: string };
const suggestions = [
  {
    icon: ChartNoAxesCombined,
    title: "See the bigger picture",
    text: "Show my spending for October 2026",
    caption: "Understand spending across your records",
  },
  {
    icon: MessageSquare,
    title: "Find a transaction",
    text: "Find payments to Ada in October 2026",
    caption: "Find the details, then check the evidence",
  },
  {
    icon: CircleHelp,
    title: "Make money make sense",
    text: "Explain how inflation affects purchasing power",
    caption: "Get a clear explanation, without the jargon",
  },
  {
    icon: Wallet,
    title: "Prepare a payment",
    text: "Help me prepare a payment draft",
    caption: "Start a draft you can review and approve",
  },
];
function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`agus-brand ${small ? "small" : ""}`}>
      <span className="agus-mark" aria-hidden="true">
        a<span>✦</span>
      </span>
      {!small && (
        <span>
          agus<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
function ResponseBody({
  reply,
  choose,
}: {
  reply: AgentReply;
  choose: (value: string) => void;
}) {
  // Format only literal amounts in the server's deterministic response. No client calculations.
  const totals =
    reply.kind === "financial"
      ? /Expenses (₦[\d,]+\.\d{2}); income (₦[\d,]+\.\d{2}); (net|filtered difference) (-?₦[\d,]+\.\d{2})/.exec(
          reply.text,
        )
      : null;
  const sources = reply.text.match(/^\[Source [^\]\n]+\]$/gm) ?? [];
  const paragraphs = reply.text
    .replace(/^\[Source [^\]\n]+\]$/gm, "")
    .trim()
    .split(/\n+/)
    .filter(Boolean);
  const selection =
    reply.kind === "clarify" && /candidate record/.test(reply.text);
  return (
    <>
      {totals && (
        <div className="agus-totals" aria-label="Financial totals">
          {[
            ["Expenses", totals[1]],
            ["Income", totals[2]],
            [totals[3] === "net" ? "Net" : "Filtered difference", totals[4]],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="agus-prose">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={
              /^[\w-]+(?:; source counterparty| on account)/.test(p)
                ? "agus-record"
                : ""
            }
          >
            {p
              .split(/(-?₦[\d,]+\.\d{2})/g)
              .map((part, j) =>
                /^-?₦/.test(part) ? <strong key={j}>{part}</strong> : part,
              )}
          </p>
        ))}
      </div>
      {selection && (
        <div className="agus-choices" aria-label="Clarification choices">
          <button
            type="button"
            onClick={() => choose("Show details for the first candidate")}
          >
            First candidate
          </button>
          <button
            type="button"
            onClick={() => choose("Show details for the second candidate")}
          >
            Second candidate
          </button>
          <button
            type="button"
            onClick={() => choose("I want to refine the search: ")}
          >
            Refine search
          </button>
        </div>
      )}
      {(sources.length > 0 || reply.citations.length > 0) && (
        <details className="agus-sources">
          <summary>
            <ShieldCheck size={14} /> Sources & evidence{" "}
            <span>{reply.citations.length}</span>
          </summary>
          <p>
            SIMULATED FICTIONAL DATA · Saved results reflect the source at the
            time of this response.
          </p>
          {sources.map((source, i) => (
            <p key={i}>{source.slice(1, -1)}</p>
          ))}
          {reply.citations.length > 0 && (
            <p>Evidence references: {reply.citations.join(" · ")}</p>
          )}
        </details>
      )}
    </>
  );
}
export function FinancialConversation() {
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<SavedTurn[]>([]);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [password, setPassword] = useState("");
  const pending = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const plans = useRef<HTMLDialogElement>(null);
  const signin = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const privacyVersion = useRef(0);
  const clearPrivate = useCallback(() => {
    ++privacyVersion.current;
    ++requestVersion.current;
    setLoading(false);
    setAuthenticated(false);
    setTurns([]);
    setChats([]);
    setAccounts([]);
    setAccount("");
    setId("");
  }, []);
  const refresh = useCallback(async () => {
    const version = privacyVersion.current;
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (version !== privacyVersion.current) return false;
    if (response.status === 401) {
      clearPrivate();
      return false;
    }
    if (!response.ok)
      throw new Error("Your saved chats couldn’t load. Try again.");
    const data = await response.json();
    if (version !== privacyVersion.current) return false;
    setAuthenticated(true);
    setChats(data.chats);
    setHistoryError("");
    return true;
  }, [clearPrivate]);
  const openChat = useCallback(
    async (next: string) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setError("");
      setText("");
      setAccount("");
      setTurns([]);
      setId(next);
      drawer.current?.close();
      window.history.replaceState(
        null,
        "",
        `?chat=${encodeURIComponent(next)}`,
      );
      try {
        const response = await fetch(
          `/api/conversations?id=${encodeURIComponent(next)}`,
          { cache: "no-store" },
        );
        if (version !== requestVersion.current) return;
        if (response.status === 401) {
          clearPrivate();
          throw new Error(
            "Your session expired. Sign in to open your saved chats.",
          );
        }
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This chat is unavailable for your account. Start a new chat."
              : "This chat couldn’t load. Select it again to retry.",
          );
        const data = await response.json();
        if (version === requestVersion.current) setTurns(data.turns);
      } catch (e) {
        if (version === requestVersion.current)
          setError(e instanceof Error ? e.message : "Chat unavailable.");
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [clearPrivate],
  );
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const ok = await refresh();
        const active = new URLSearchParams(window.location.search).get("chat");
        if (live && ok && active) await openChat(active);
      } catch (e) {
        if (live)
          setHistoryError(
            e instanceof Error ? e.message : "Saved chats unavailable.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh, openChat]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [turns, pendingText]);
  function newChat() {
    ++requestVersion.current;
    setId("");
    setTurns([]);
    setText("");
    setAccount("");
    setError("");
    setLoading(false);
    window.history.replaceState(null, "", "/conversation");
    drawer.current?.close();
    composer.current?.focus();
  }
  function choose(value: string) {
    setText(value);
    composer.current?.focus();
  }
  async function loadAccounts() {
    const version = privacyVersion.current;
    setAccountLoading(true);
    setAccountError("");
    try {
      const response = await fetch("/api/financial-agent", {
        cache: "no-store",
      });
      if (version !== privacyVersion.current) return;
      if (response.status === 401) {
        clearPrivate();
        throw new Error("Sign in to load your authorized fictional accounts.");
      }
      if (!response.ok)
        throw new Error(
          "Accounts couldn’t load. You can still ask a general question.",
        );
      const data = await response.json();
      if (version === privacyVersion.current) setAccounts(data.accounts);
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Accounts unavailable.");
    } finally {
      setAccountLoading(false);
    }
  }
  async function send() {
    if (pending.current || loading || !text.trim()) return;
    if (!authenticated) {
      signin.current?.showModal();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    const original = text;
    const chatId = id || crypto.randomUUID();
    setPendingText(original);
    try {
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: chatId,
          text: original,
          accountIds: account ? [account] : [],
        }),
      });
      const data = await response.json();
      if (response.status === 401) {
        clearPrivate();
        throw new Error(
          "Your session expired. Sign in again; your message is still here.",
        );
      }
      if (data.turn) {
        setId(chatId);
        window.history.replaceState(
          null,
          "",
          `?chat=${encodeURIComponent(chatId)}`,
        );
        setTurns((previous) => [...previous, data.turn]);
        setText("");
        void refresh().catch(() =>
          setHistoryError(
            "Your reply is saved, but the chat list couldn’t refresh. Retry the list.",
          ),
        );
      } else if (!response.ok)
        throw new Error(
          response.status === 409
            ? "Another response is in progress in this chat. Wait a moment, then try again."
            : "AGUS couldn’t connect. Your message is preserved; please try again.",
        );
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "AGUS couldn’t connect. Your message is preserved; please try again."
          : e instanceof Error
            ? e.message
            : "Request unavailable. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      setPendingText("");
      window.requestAnimationFrame(() => composer.current?.focus());
    }
  }
  async function draft(original: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: original }),
      });
      if (!response.ok)
        throw new Error(
          "The draft couldn’t open. Please try again or open the payment workspace.",
        );
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft unavailable.");
      pending.current = false;
      setBusy(false);
    }
  }
  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Too many attempts. Please try again in 15 minutes."
            : "Sign-in failed. Check your operator password and try again.",
        );
      setPassword("");
      signin.current?.close();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in unavailable.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      ++requestVersion.current;
      clearPrivate();
      setText("");
      window.history.replaceState(null, "", "/conversation");
      drawer.current?.close();
    } catch {
      setError("Sign-out couldn’t complete. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const sidebar = (
    <>
      <div className="agus-sidebar-brand">
        <Brand />
        <span className="agus-eyebrow">FINANCIAL COPILOT</span>
      </div>
      <button className="agus-new" disabled={busy} onClick={newChat}>
        <Plus size={18} /> New chat <ArrowUpRight size={14} />
      </button>
      <div className="agus-history-heading">
        YOUR CONVERSATIONS <MessageSquare size={13} />
      </div>
      <nav aria-label="Saved chats" className="agus-history">
        {loading && chats.length === 0 ? (
          <p className="agus-sidebar-empty">Loading your chats…</p>
        ) : chats.length ? (
          chats.map((chat) => (
            <button
              key={chat.id}
              className={id === chat.id ? "active" : ""}
              aria-current={id === chat.id ? "page" : undefined}
              disabled={busy}
              onClick={() => void openChat(chat.id)}
              title={chat.title}
            >
              <MessageSquare size={15} />
              <span>{chat.title}</span>
            </button>
          ))
        ) : (
          <div className="agus-sidebar-empty">
            <MessageSquare size={23} />
            <p>
              {authenticated === false
                ? "Your conversations, in one place."
                : "A little clarity starts with a conversation."}
            </p>
            <small>
              {authenticated === false
                ? "Sign in to save and revisit your chats."
                : "Your first chat will appear here."}
            </small>
          </div>
        )}
        {historyError && (
          <div className="agus-sidebar-empty" role="alert">
            <p>{historyError}</p>
            <button
              onClick={() =>
                void refresh().catch(() =>
                  setHistoryError(
                    "Saved chats are still unavailable. Please retry.",
                  ),
                )
              }
            >
              Retry saved chats
            </button>
          </div>
        )}
      </nav>
      <div className="agus-sidebar-bottom">
        <Link href="/" className="agus-sidebar-link">
          <Wallet size={17} /> Payment workspace <ArrowUpRight size={15} />
        </Link>
        <button
          className="agus-plan-link"
          onClick={() => plans.current?.showModal()}
        >
          <Sparkles size={17} />
          <span>
            Explore AGUS plans<small>Free · Personal Plus · Business</small>
          </span>
          <span className="agus-preview">Preview</span>
        </button>
        <div className="agus-profile">
          <span className="agus-avatar">{authenticated ? "D" : "G"}</span>
          <span>
            {authenticated ? "Demo workspace" : "Guest workspace"}
            <small>
              {authenticated
                ? "Signed in · Fictional data"
                : "Sign in to get started"}
            </small>
          </span>
          <button
            aria-label={authenticated ? "Sign out" : "Sign in"}
            disabled={busy}
            onClick={() =>
              authenticated ? void signOut() : signin.current?.showModal()
            }
          >
            {authenticated ? <LogOut size={16} /> : <ArrowUpRight size={16} />}
          </button>
        </div>
      </div>
    </>
  );
  return (
    <main className="agus-workspace">
      <a className="agus-skip" href="#financial-message">
        Skip to message
      </a>
      <aside className="agus-sidebar" aria-label="Conversation sidebar">
        {sidebar}
      </aside>
      <dialog
        ref={drawer}
        className="agus-dialog agus-drawer"
        aria-label="Conversations"
      >
        <button
          className="agus-icon-button agus-drawer-close"
          aria-label="Close conversations"
          onClick={() => drawer.current?.close()}
        >
          <X size={20} />
        </button>
        {sidebar}
      </dialog>
      <section className="agus-main" aria-label="AGUS conversation workspace">
        <header className="agus-header">
          <div>
            <button
              className="agus-icon-button agus-mobile-menu"
              aria-label="Open conversations"
              onClick={() => drawer.current?.showModal()}
            >
              <Menu size={21} />
            </button>
            <span className="agus-header-title">
              AGUS <span> / </span>
              <span>{id ? "Conversation" : "New conversation"}</span>
            </span>
          </div>
          <details className="agus-account-picker">
            <summary>
              <span className="agus-status-dot" />
              {account ? "Account selected" : "Choose account"}
              <ChevronDown size={14} />
            </summary>
            <div className="agus-account-panel">
              <h2>Financial context</h2>
              <p>
                Choose an authorized fictional account for personal financial
                questions. General conversation needs no account.
              </p>
              <button
                className="agus-secondary"
                disabled={busy || accountLoading}
                onClick={() => void loadAccounts()}
              >
                {accountLoading
                  ? "Loading accounts…"
                  : "Load authorized accounts"}
              </button>
              <label htmlFor="agus-account">Account (optional)</label>
              <select
                id="agus-account"
                value={account}
                disabled={busy}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">No account · General conversation</option>
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.displayName} {a.maskedNumber}
                  </option>
                ))}
              </select>
              <small>
                Selections are cleared when switching chats. Follow-up context
                expires after 15 minutes; saved transcripts remain.
              </small>
              {accountError && <p role="alert">{accountError}</p>}
            </div>
          </details>
        </header>
        <div className="agus-demo-strip">
          <ShieldCheck size={13} />
          <span>
            SIMULATED FICTIONAL DATA{" "}
            <span className="agus-strip-detail">
              · No real banking or money movement
            </span>
          </span>
        </div>
        <div className="agus-scroll">
          {loading ? (
            <div className="agus-loading" role="status">
              <Loader2 className="agus-spin" size={22} /> Opening your
              workspace…
            </div>
          ) : turns.length === 0 && !pendingText ? (
            <section className="agus-welcome">
              <div className="agus-welcome-kicker">
                <span /> A LITTLE CLARITY. A LOT OF POSSIBILITY.
              </div>
              <Brand small />
              <h1>
                Big plans.
                <br />
                <span>Let’s talk money.</span>
              </h1>
              <p>
                Your financial life, a little less complicated.
                <br className="agus-desktop-break" /> Ask a question, explore
                your records, or work through an idea.
              </p>
              <div className="agus-suggestions">
                {suggestions.map(
                  ({ icon: Icon, title, text: prompt, caption }) => (
                    <button key={title} onClick={() => choose(prompt)}>
                      <span className="agus-prompt-icon">
                        <Icon size={20} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{caption}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ),
                )}
              </div>
              <p className="agus-welcome-note">
                <ShieldCheck size={14} /> You stay in control. Payments always
                need your approval.
              </p>
            </section>
          ) : (
            <section
              className="agus-thread"
              aria-label="Conversation replies"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              <p className="agus-history-note">
                Saved conversation · Follow-up context expires after 15 minutes.
                Choose an account to check current records.
              </p>
              {turns.map((turn) => (
                <article key={turn.id} className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You</span>
                    <p>{turn.text}</p>
                  </div>
                  <div className="agus-assistant-message">
                    <div className="agus-response-heading">
                      <Brand small />
                      <strong>AGUS</strong>
                      <span>
                        {turn.reply.kind === "financial"
                          ? "Fictional financial records"
                          : turn.reply.kind === "clarify"
                            ? "Let’s clarify"
                            : "Your financial copilot"}
                      </span>
                    </div>
                    {(turn.reply.kind === "unavailable" ||
                      turn.reply.kind === "conflict") && (
                      <p className="agus-reply-notice">
                        {turn.reply.kind === "conflict"
                          ? "The financial context changed. Repeat the request with the account and dates, or start a new chat."
                          : "This request wasn’t completed. You can try again or ask another question."}
                      </p>
                    )}
                    <ResponseBody reply={turn.reply} choose={choose} />
                    {turn.reply.handoff && (
                      <div className="agus-handoff">
                        <p>
                          Start an editable draft. Verify the details, review
                          and approve in the payment workspace.
                        </p>
                        <button
                          className="agus-secondary"
                          disabled={busy}
                          onClick={() => void draft(turn.text)}
                        >
                          Continue in payment draft <ArrowUpRight size={16} />
                        </button>
                      </div>
                    )}
                    <span className="agus-response-time">
                      {new Date(turn.createdAt).toLocaleTimeString("en-NG", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Africa/Lagos",
                      })}{" "}
                      WAT · Saved
                    </span>
                  </div>
                </article>
              ))}
              {pendingText && (
                <article className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You</span>
                    <p>{pendingText}</p>
                  </div>
                  <div className="agus-thinking" role="status">
                    <Brand small />
                    <span>
                      Thinking through your question
                      <span className="agus-thinking-dots">…</span>
                    </span>
                  </div>
                </article>
              )}
              <div ref={end} />
            </section>
          )}
        </div>
        <div className="agus-composer-area">
          {error && (
            <div className="agus-error" role="alert">
              {error}
              {authenticated === false && (
                <button onClick={() => signin.current?.showModal()}>
                  Sign in
                </button>
              )}
            </div>
          )}
          {authenticated === false && (
            <p className="agus-signin-hint">
              <button onClick={() => signin.current?.showModal()}>
                Sign in
              </button>{" "}
              to chat and keep your conversations saved.
            </p>
          )}
          <form
            className="agus-composer"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="agus-sr-only" htmlFor="financial-message">
              Message AGUS
            </label>
            <textarea
              ref={composer}
              id="financial-message"
              placeholder="Ask AGUS anything…"
              value={text}
              rows={2}
              maxLength={4000}
              disabled={busy || loading}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="agus-composer-toolbar">
              <span>
                <Sparkles size={14} /> Think it through with AGUS
              </span>
              <span className="agus-character-count">
                {text.length > 3500 ? `${text.length}/4000` : ""}
              </span>
              <button
                className="agus-send"
                type="submit"
                aria-label="Send message"
                disabled={busy || loading || !text.trim()}
              >
                {busy ? (
                  <Loader2 size={19} className="agus-spin" />
                ) : (
                  <ArrowUp size={20} />
                )}
              </button>
            </div>
          </form>
          <p className="agus-composer-note">
            AGUS can make mistakes. Check financial details.{" "}
            <span>Enter to send · Shift + Enter for a new line</span>
          </p>
        </div>
      </section>
      <dialog
        className="agus-dialog agus-plans"
        ref={plans}
        aria-labelledby="agus-plans-title"
      >
        <div className="agus-dialog-heading">
          <span className="agus-eyebrow">ROOM TO GROW</span>
          <button
            className="agus-icon-button"
            aria-label="Close plans"
            onClick={() => plans.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="agus-plans-title">A plan for every next step.</h2>
        <p>
          Proposed AGUS plans <span className="agus-preview">Preview</span>
        </p>
        <div className="agus-plan-grid">
          {[
            {
              name: "Free",
              icon: MessageSquare,
              description: "A place to start finding clarity.",
              features: [
                "Everyday conversations",
                "Financial education",
                "Explore the demo workspace",
              ],
            },
            {
              name: "Personal Plus",
              icon: Sparkles,
              description: "More room for your financial life.",
              features: [
                "Proposed expanded access",
                "Personal finance workflows",
                "Deeper record exploration",
              ],
            },
            {
              name: "Business",
              icon: CreditCard,
              description: "Clarity for the work you’re building.",
              features: [
                "Proposed team workspace",
                "Business finance workflows",
                "Collaborative payment review",
              ],
            },
          ].map(({ name, icon: Icon, description, features }) => (
            <section key={name}>
              <Icon size={22} />
              <h3>{name}</h3>
              <p>{description}</p>
              <ul>
                {features.map((f) => (
                  <li key={f}>
                    <Check size={14} />
                    {f}
                  </li>
                ))}
              </ul>
              <span className="agus-preview">Proposed tier</span>
            </section>
          ))}
        </div>
        <p className="agus-plan-disclosure">
          Plans are a product preview. Pricing, quotas and subscriptions are not
          active. Usage is not metered here, and no billing or plan activation
          is available.
        </p>
      </dialog>
      <dialog
        className="agus-dialog agus-signin"
        aria-labelledby="agus-signin-title"
        ref={signin}
        onClose={() => setPassword("")}
      >
        <div className="agus-dialog-heading">
          <Brand />
          <button
            className="agus-icon-button"
            aria-label="Close sign in"
            onClick={() => signin.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="agus-signin-title">Welcome to your workspace.</h2>
        <p>
          Sign in with the existing demo operator password. Your chats are saved
          to your authenticated workspace.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label htmlFor="agus-password">Operator password</label>
          <input
            id="agus-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
          <button className="agus-secondary" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in securely"}
          </button>
        </form>
        {error && (
          <p className="agus-error" role="alert">
            {error}
          </p>
        )}
        <small>Fictional demo · No real banking credentials</small>
      </dialog>
    </main>
  );
}
