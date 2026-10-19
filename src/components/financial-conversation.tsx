"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  CreditCard,
  LogOut,
  PanelLeft,
  SquarePen,
  MessageSquare,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import type { SavedChat, SavedTurn } from "@/lib/chat-history/store";
import { BrandAsset } from "./brand-asset";
import { FinancialResponse } from "./financial-response";
import { conversationDrafts as drafts } from "@/lib/chat-history/drafts";
import "./financial-conversation.css";

type Account = {
  accountId: string;
  displayName: string;
  maskedNumber: string | null;
};
// Transient only. No transcripts, account selection or draft text enter browser storage.
const suggestions = [
  {
    title: "Analyze spending",
    text: "Show my spending for October 2026",
  },
  {
    title: "Track a payment",
    text: "Find payments to Ada in October 2026",
  },
  {
    title: "Prepare a transfer",
    text: "Help me prepare a payment draft",
  },
];
export function FinancialConversation() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<SavedTurn[]>([]);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [signinError, setSigninError] = useState("");
  const [showLatest, setShowLatest] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [longWait, setLongWait] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [unknown, setUnknown] = useState<{
    chat: string;
    count: number;
    payment?: boolean;
  } | null>(null);
  const pending = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const plans = useRef<HTMLDialogElement>(null);
  const signin = useRef<HTMLDialogElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const modalReturn = useRef<HTMLElement | null>(null);
  const requestVersion = useRef(0);
  const privacyVersion = useRef(0);
  const follow = useRef(true);
  const busy = !!operation;
  const updateText = (value: string) => {
    setText(value);
    drafts.set(id, value);
  };
  const clearPrivate = useCallback(() => {
    ++privacyVersion.current;
    ++requestVersion.current;
    drafts.clear();
    pending.current = false;
    setOperation("");
    setAccountLoading(false);
    setLoading(false);
    setAuthenticated(false);
    setTurns([]);
    setChats([]);
    setAccounts([]);
    setAccount("");
    setId("");
    setPendingText("");
    setUnknown(null);
    setPassword("");
  }, []);
  function openModal(target: HTMLDialogElement | null) {
    const active = document.activeElement as HTMLElement;
    modalReturn.current = active?.closest("dialog") ? menu.current : active;
    [drawer, plans, signin, accountDialog].forEach((r) => r.current?.close());
    target?.showModal();
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      if (!document.querySelector("dialog[open]")) modalReturn.current?.focus();
    });
  }
  function toggleSidebar(open: boolean) {
    setSidebarOpen(open);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          open ? ".agus-sidebar .agus-collapse" : ".agus-navigation-toggle",
        )
        ?.focus();
    });
  }
  const refresh = useCallback(async () => {
    const version = privacyVersion.current;
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (version !== privacyVersion.current) return false;
    if (response.status === 401) {
      clearPrivate();
      return false;
    }
    if (!response.ok)
      throw new Error("Saved chats couldn’t load. Retry the list.");
    const data = await response.json();
    if (version !== privacyVersion.current) return false;
    setAuthenticated(true);
    setChats(data.chats);
    setHistoryError("");
    return true;
  }, [clearPrivate]);
  const openChat = useCallback(
    async (next: string, push = true) => {
      const version = ++requestVersion.current;
      setLoading(!!next);
      setError("");
      setText(drafts.get(next) ?? "");
      setAccount("");
      setAccounts([]);
      setTurns([]);
      setId(next);
      setUnknown(null);
      setPendingText("");
      follow.current = true;
      drawer.current?.close();
      if (push)
        window.history.pushState(
          null,
          "",
          next ? `?chat=${encodeURIComponent(next)}` : "/conversation",
        );
      if (!next) return;
      try {
        const response = await fetch(
          `/api/conversations?id=${encodeURIComponent(next)}`,
          { cache: "no-store" },
        );
        if (version !== requestVersion.current) return;
        if (response.status === 401) {
          clearPrivate();
          throw new Error("Your session expired. Sign in to open saved chats.");
        }
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This chat is unavailable. Start a new chat."
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
        if (live && ok) await openChat(active ?? "", false);
      } catch (e) {
        if (live)
          setHistoryError(
            e instanceof Error ? e.message : "Saved chats unavailable.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    const pop = () =>
      void openChat(
        new URLSearchParams(window.location.search).get("chat") ?? "",
        false,
      );
    window.addEventListener("popstate", pop);
    const versions = requestVersion;
    return () => {
      live = false;
      ++versions.current;
      window.removeEventListener("popstate", pop);
    };
  }, [refresh, openChat]);
  useEffect(() => {
    if (follow.current) {
      end.current?.scrollIntoView({ block: "end", behavior: "instant" });
      setShowLatest(false);
    } else if (turns.length) setShowLatest(true);
  }, [turns, pendingText]);
  useEffect(() => {
    const input = composer.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, window.innerHeight < 520 ? 80 : 160)}px`;
    }
  }, [text]);
  useEffect(() => {
    if (!busy) {
      setLongWait(false);
      return;
    }
    const timer = setTimeout(() => setLongWait(true), 10000);
    return () => clearTimeout(timer);
  }, [busy]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const fit = () => {
      const el = document.querySelector<HTMLElement>(".agus-workspace");
      el?.style.setProperty(
        "--workspace-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      el?.style.setProperty("--workspace-top", `${viewport?.offsetTop ?? 0}px`);
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }, []);
  function choose(value: string) {
    if (text.trim()) {
      setError(
        "Your draft is preserved. Clear it before choosing a suggestion.",
      );
      return;
    }
    updateText(value);
    composer.current?.focus();
  }
  async function loadAccounts() {
    const version = privacyVersion.current,
      request = requestVersion.current;
    setAccountLoading(true);
    setAccountError("");
    try {
      const response = await fetch("/api/financial-agent", {
        cache: "no-store",
      });
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (response.status === 401) {
        clearPrivate();
        throw new Error("Sign in to load authorized accounts.");
      }
      if (!response.ok)
        throw new Error(
          "Accounts couldn’t load. General conversation remains available.",
        );
      const data = await response.json();
      if (
        version === privacyVersion.current &&
        request === requestVersion.current
      )
        setAccounts(data.accounts);
    } catch (e) {
      if (version === privacyVersion.current)
        setAccountError(
          e instanceof Error ? e.message : "Accounts unavailable.",
        );
    } finally {
      if (version === privacyVersion.current) setAccountLoading(false);
    }
  }
  async function send() {
    if (pending.current || loading || unknown || !text.trim()) return;
    if (!authenticated) {
      openModal(signin.current);
      return;
    }
    pending.current = true;
    setOperation("message");
    setError("");
    const original = text,
      chatId = id || crypto.randomUUID(),
      version = privacyVersion.current,
      request = requestVersion.current;
    setPendingText(original);
    setText("");
    drafts.set(id, "");
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: chatId,
          text: original,
          accountIds: account ? [account] : [],
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (response.status === 401) {
        clearPrivate();
        setText(original);
        drafts.set("", original);
        setError(
          "Your session expired. Sign in again; your unsent question is retained.",
        );
        return;
      }
      if (data.turn) {
        setId(chatId);
        drafts.delete(id);
        drafts.set(chatId, "");
        if (!id)
          window.history.replaceState(
            null,
            "",
            `/conversation?chat=${encodeURIComponent(chatId)}`,
          );
        setTurns((previous) => [...previous, data.turn]);
        setAnnouncement("Response saved. The answer is ready.");
        void refresh().catch(() => {
          if (version === privacyVersion.current)
            setHistoryError(
              "Reply saved; conversation list could not refresh.",
            );
        });
      } else {
        setText(original);
        drafts.set(id, original);
        setError(
          response.status === 409
            ? "A response is already in progress. Check the saved conversation before trying again."
            : "Your message wasn’t completed. Review it and try again.",
        );
        if (response.status === 409 || response.status >= 500)
          setUnknown({ chat: chatId, count: turns.length });
      }
    } catch {
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      setText(original);
      drafts.set(id, original);
      setUnknown({ chat: chatId, count: turns.length });
      setError(
        "The response could not be confirmed. Check this conversation before trying again.",
      );
    } finally {
      clearTimeout(timeout);
      pending.current = false;
      if (version === privacyVersion.current) {
        setOperation("");
        setPendingText("");
      }
    }
  }
  async function checkSaved() {
    if (!unknown) return;
    const version = privacyVersion.current,
      request = requestVersion.current;
    setOperation("check");
    try {
      const response = await fetch(
        `/api/conversations?id=${encodeURIComponent(unknown.chat)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        clearPrivate();
        return;
      }
      const data = response.ok ? await response.json() : null;
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (!response.ok && response.status !== 404) throw new Error();
      if (data?.turns.length > unknown.count) {
        setTurns(data.turns);
        setId(unknown.chat);
        setText("");
        drafts.delete(id);
        drafts.set(unknown.chat, "");
        window.history.replaceState(
          null,
          "",
          `/conversation?chat=${encodeURIComponent(unknown.chat)}`,
        );
        setError("");
        setUnknown(null);
        void refresh();
      } else if (data?.inProgress)
        setError(
          "The saved conversation is still processing. Check again before trying to send.",
        );
      else {
        setError(
          "No new saved response was found. Your draft is preserved. You can now explicitly retry.",
        );
        setUnknown(null);
      }
    } catch {
      setError(
        "Saved state couldn’t be checked. Check again before trying to send.",
      );
    } finally {
      if (version === privacyVersion.current) setOperation("");
    }
  }
  async function draft(original: string) {
    if (pending.current || unknown) return;
    pending.current = true;
    setOperation("draft");
    setError("");
    const version = privacyVersion.current;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: original }),
      });
      if (version !== privacyVersion.current) return;
      if (!response.ok) throw new Error();
      router.push(`/?fromChat=${encodeURIComponent(id)}`);
    } catch {
      if (version === privacyVersion.current) {
        setUnknown({ chat: id, count: turns.length, payment: true });
        setError(
          "The draft response could not be confirmed. Check the payment workspace for a saved draft before creating another.",
        );
      }
    } finally {
      pending.current = false;
      if (version === privacyVersion.current) setOperation("");
    }
  }
  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setOperation("signin");
    setSigninError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Too many attempts. Try again in 15 minutes."
            : "Sign-in failed. Check your operator password.",
        );
      setPassword("");
      signin.current?.close();
      await refresh();
    } catch (e) {
      setSigninError(
        e instanceof Error ? e.message : "Sign-in unavailable. Try again.",
      );
    } finally {
      pending.current = false;
      setOperation("");
    }
  }
  async function signOut() {
    setOperation("signout");
    ++privacyVersion.current;
    ++requestVersion.current;
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      clearPrivate();
      setText("");
      setError("");
      window.history.replaceState(null, "", "/conversation");
      drawer.current?.close();
    } catch {
      setError("Sign-out couldn’t complete. Try again.");
    } finally {
      pending.current = false;
      setPendingText("");
      setOperation("");
    }
  }
  const selected = accounts.find((a) => a.accountId === account);
  const scope = selected
    ? `${selected.displayName}${selected.maskedNumber ? ` · •${selected.maskedNumber}` : ""}`
    : "No account selected";
  const paymentUrl = id
    ? `/?fromChat=${encodeURIComponent(id)}`
    : "/?workspace=payments";
  const empty = !loading && !turns.length && !pendingText;
  const sidebar = (
    <>
      <div className="agus-sidebar-brand">
        <button
          className="agus-icon-button agus-collapse"
          aria-label="Collapse navigation"
          onClick={() => toggleSidebar(false)}
        >
          <PanelLeft size={20} />
        </button>
      </div>
      <button
        className="agus-new"
        disabled={busy}
        onClick={() => void openChat("")}
      >
        <Plus size={18} /> New chat
      </button>
      <div className="agus-history-heading">Saved conversations</div>
      <nav aria-label="Saved chats" className="agus-history">
        {chats.map((chat) => (
          <button
            key={chat.id}
            className={id === chat.id ? "active" : ""}
            aria-current={id === chat.id ? "page" : undefined}
            disabled={busy}
            onClick={() => void openChat(chat.id)}
            title={chat.title}
          >
            <MessageSquare size={18} />
            <span>{chat.title}</span>
          </button>
        ))}
        {!chats.length && (
          <p className="agus-sidebar-empty">
            {loading
              ? "Loading conversations…"
              : authenticated
                ? "Your first saved chat will appear here."
                : "Sign in to save and revisit chats."}
          </p>
        )}
        {historyError && (
          <div className="agus-sidebar-empty" role="alert">
            <p>{historyError}</p>
            <button
              onClick={() =>
                void refresh().catch(() =>
                  setHistoryError("Saved chats are still unavailable."),
                )
              }
            >
              Retry saved chats
            </button>
          </div>
        )}
      </nav>
      <div className="agus-sidebar-bottom">
        <Link href={paymentUrl} className="agus-sidebar-link">
          <Wallet size={18} /> Payment workspace
        </Link>
        <button
          className="agus-plan-link"
          onClick={() => openModal(plans.current)}
        >
          <CreditCard size={18} /> Plans · Preview
        </button>
        {authenticated && (
          <button
            className="agus-account-trigger"
            aria-label={`Account: ${scope}`}
            onClick={() => {
              openModal(accountDialog.current);
              void loadAccounts();
            }}
          >
            {scope}
          </button>
        )}
        {authenticated ? (
          <div className="agus-profile">
            <span>
              Demo workspace
              <small>Shared operator identity</small>
            </span>
            <button aria-label="Sign out" onClick={() => void signOut()}>
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <button
            className="agus-sidebar-link agus-signin-trigger"
            onClick={() => openModal(signin.current)}
          >
            Sign in
          </button>
        )}
      </div>
    </>
  );
  return (
    <main className={`agus-workspace ${empty ? "agus-empty" : ""}`}>
      {!empty && <h1 className="agus-sr-only">Conversation</h1>}
      <a className="agus-skip" href="#financial-message">
        Skip to message
      </a>
      {sidebarOpen && (
        <aside
          id="agus-navigation"
          className="agus-sidebar"
          aria-label="Conversation sidebar"
        >
          {sidebar}
        </aside>
      )}
      <dialog
        ref={drawer}
        className="agus-dialog agus-drawer"
        aria-label="Conversations"
        onClose={restoreFocus}
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
      <section className="agus-main" aria-label="agus. conversation workspace">
        <header className="agus-header">
          <div>
            <button
              ref={menu}
              className="agus-icon-button agus-navigation-toggle"
              aria-label="Open conversations"
              onClick={() => {
                if (window.matchMedia("(min-width: 1024px)").matches)
                  toggleSidebar(!sidebarOpen);
                else openModal(drawer.current);
              }}
            >
              <PanelLeft size={20} />
            </button>
            <BrandAsset />
            {!empty && (
              <span
                className="agus-header-title"
                title={chats.find((c) => c.id === id)?.title}
              >
                {chats.find((c) => c.id === id)?.title ?? "New conversation"}
              </span>
            )}
          </div>
          <button
            className="agus-icon-button"
            aria-label="New chat"
            title="New chat"
            disabled={busy}
            onClick={() => void openChat("")}
          >
            <SquarePen size={20} />
          </button>
        </header>
        {selected && <p className="agus-active-scope">{scope}</p>}
        <div
          className="agus-scroll"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el) {
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              if (follow.current) setShowLatest(false);
            }
          }}
        >
          {loading ? (
            <p role="status">Opening conversation…</p>
          ) : empty ? (
            <section className="agus-welcome">
              <h1 className="agus-welcome-question">Let's talk money.</h1>
            </section>
          ) : (
            <section className="agus-thread" aria-label="Conversation replies">
              {turns.some((t) => t.reply.kind === "financial") && !account && (
                <p className="agus-history-note">
                  Saved results reflect the data available then. Choose an
                  account to check current records.
                </p>
              )}
              {turns.map((turn) => (
                <article key={turn.id} className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You</span>
                    <p>{turn.text}</p>
                  </div>
                  <div className="agus-assistant-message">
                    <h2 className="agus-response-heading">agus.</h2>
                    {turn.reply.kind === "conflict" && (
                      <p className="agus-reply-notice">
                        Your financial context changed. Choose an account and
                        check the records again.
                      </p>
                    )}
                    <FinancialResponse reply={turn.reply} choose={choose} />
                    {turn.reply.handoff && (
                      <div className="agus-handoff">
                        <p>Payment preparation</p>
                        <button
                          className="agus-secondary"
                          disabled={busy || !!unknown}
                          onClick={() => void draft(turn.text)}
                        >
                          Open payment draft <ArrowUpRight size={18} />
                        </button>
                      </div>
                    )}
                    <span className="agus-response-time">
                      Saved{" "}
                      {new Date(turn.createdAt).toLocaleString("en-NG", {
                        timeZone: "Africa/Lagos",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      WAT
                    </span>
                  </div>
                </article>
              ))}
              {pendingText && (
                <article className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You · Sending</span>
                    <p>{pendingText}</p>
                  </div>
                  <p className="agus-thinking" role="status">
                    Working on your question…
                    {longWait && " This is taking longer than usual."}
                  </p>
                </article>
              )}
              <div ref={end} />
            </section>
          )}
        </div>
        {showLatest && (
          <button
            className="agus-latest"
            onClick={() => {
              follow.current = true;
              end.current?.scrollIntoView({
                block: "end",
                behavior: "instant",
              });
              setShowLatest(false);
            }}
          >
            Latest response
          </button>
        )}
        <div className="agus-composer-area">
          {error && (
            <div className="agus-error" role="alert">
              <p>{error}</p>
              {unknown &&
                (unknown.payment ? (
                  <Link href={paymentUrl}>Check payment workspace</Link>
                ) : (
                  <button disabled={busy} onClick={() => void checkSaved()}>
                    Check saved conversation
                  </button>
                ))}
            </div>
          )}
          {busy && operation !== "message" && (
            <p role="status">
              {operation === "draft"
                ? "Opening payment draft…"
                : operation === "check"
                  ? "Checking saved conversation…"
                  : "Updating session…"}
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
              placeholder="Ask agus..."
              value={text}
              rows={1}
              maxLength={4000}
              readOnly={busy || loading}
              onChange={(e) => updateText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  !window.matchMedia("(pointer: coarse)").matches
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="agus-composer-toolbar">
              <span className="agus-character-count">
                {text.length >= 3500
                  ? `${text.length}/4000${text.length === 4000 ? " · Message limit reached" : ""}`
                  : busy
                    ? "Wait for this request before sending another."
                    : ""}
              </span>
              {/* Gerald's optional toolbar action belongs here; no second voice implementation. */}
              <button
                className="agus-send"
                type="submit"
                aria-label="Send message"
                disabled={busy || loading || !!unknown || !text.trim()}
              >
                <ArrowUp size={20} />
              </button>
            </div>
          </form>
          {empty && (
            <div className="agus-suggestions">
              {suggestions.map(({ title, text: prompt }) => (
                <button key={title} onClick={() => choose(prompt)}>
                  <span>{title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <details className="agus-demo-strip">
          <summary>Demo · Fictional financial data</summary>
          <p>
            These are fictional source records. No real banking is connected and
            no real funds move.
          </p>
        </details>
      </section>
      <div className="agus-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <dialog
        className="agus-dialog agus-account-dialog"
        ref={accountDialog}
        aria-labelledby="agus-account-title"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-account-title">Account</h2>
          <button
            className="agus-icon-button"
            aria-label="Close account"
            onClick={() => accountDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Choose fictional demo records for personal-record questions. General
          conversation needs no account.
        </p>
        {accountLoading && <p role="status">Loading authorized accounts…</p>}
        <label htmlFor="agus-account">Account (optional)</label>
        <select
          id="agus-account"
          value={account}
          disabled={busy || accountLoading}
          onChange={(e) => {
            setAccount(e.target.value);
            setAnnouncement(
              e.target.value
                ? `Selected ${accounts.find((a) => a.accountId === e.target.value)?.displayName}`
                : "General conversation selected",
            );
          }}
        >
          <option value="">General conversation · No account selected</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>
              {a.displayName}
              {a.maskedNumber ? ` · •${a.maskedNumber}` : ""}
            </option>
          ))}
        </select>
        {accountError && <p role="alert">{accountError}</p>}
        {(accountError || authenticated === false) && (
          <button
            className="agus-secondary"
            disabled={accountLoading}
            onClick={() =>
              authenticated ? void loadAccounts() : openModal(signin.current)
            }
          >
            {authenticated ? "Retry authorized accounts" : "Sign in"}
          </button>
        )}
      </dialog>
      <dialog
        className="agus-dialog agus-plans"
        ref={plans}
        aria-labelledby="agus-plans-title"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-plans-title">Plans</h2>
          <button
            className="agus-icon-button"
            aria-label="Close plans"
            onClick={() => plans.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>Preview · Subscriptions and billing are not active.</p>
        <p>Usage isn’t metered in this demo.</p>
        <div className="agus-plan-grid">
          {[
            {
              name: "Free",
              items: [
                "Everyday conversations",
                "Financial education",
                "Explore the demo workspace",
              ],
            },
            {
              name: "Personal Plus",
              items: [
                "Proposed expanded access",
                "Personal finance workflows",
                "Deeper record exploration",
              ],
            },
            {
              name: "Business",
              items: [
                "Proposed team workspace",
                "Business finance workflows",
                "Collaborative payment review",
              ],
            },
          ].map((tier) => (
            <section key={tier.name}>
              <h3>{tier.name}</h3>
              <span className="agus-preview">Proposed tier</span>
              <ul>
                {tier.items.map((item) => (
                  <li key={item}>
                    <Check size={14} /> {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
      <dialog
        className="agus-dialog agus-signin"
        ref={signin}
        aria-labelledby="agus-signin-title"
        onClose={() => {
          setPassword("");
          restoreFocus();
        }}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-signin-title">Sign in</h2>
          <button
            className="agus-icon-button"
            aria-label="Close sign in"
            onClick={() => signin.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <BrandAsset lockup />
        <p>
          This demo uses a shared operator identity. People using the same
          operator identity share its saved chats.
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
            {operation === "signin" ? "Signing in…" : "Continue"}
          </button>
        </form>
        {signinError && (
          <p className="agus-error" role="alert">
            {signinError}
          </p>
        )}
      </dialog>
    </main>
  );
}
