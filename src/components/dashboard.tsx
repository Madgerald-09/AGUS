"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Paperclip,
  Menu,
  Check,
  CircleAlert,
  CircleX,
  Undo2,
  KeyRound,
  LockKeyhole,
  Search,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  FileDown,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
  Activity,
} from "lucide-react";
import type {
  Batch,
  LedgerEntry,
  Message,
  Audit,
  Mode,
  Instruction,
} from "@/lib/domain";
import type { Insight } from "@/lib/intelligence";
type ViewBatch = Batch & { reviewDigest: string };
type Row = {
  name: string;
  bankCode: string;
  accountNumber: string;
  amountNaira: string;
  reason: string;
  warnings?: string[];
};
type Snapshot = {
  operator: string;
  mode: Mode;
  aiEnabled: boolean;
  aiProvider: string;
  emergencyDisabled: boolean;
  liveEnabled: boolean;
  maxPaymentKobo: number;
  maxBatchKobo: number;
  feeReserveKobo: number;
  batches: ViewBatch[];
  messages: Message[];
  ledger: LedgerEntry[];
  insights: Insight;
  audit: Audit[];
  fixtureBeneficiaries: {
    name: string;
    bankCode: string;
    accountNumber: string;
  }[];
};
const money = (n: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(n / 100);
const date = (s: string) =>
  new Date(s).toLocaleString("en-NG", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
const blank = (): Row => ({
  name: "",
  bankCode: "",
  accountNumber: "",
  amountNaira: "",
  reason: "Payment",
});
const label = (s: string) => s.replaceAll("_", " ");
const bankName = (code: string, banks: { name: string; code: string }[]) =>
  banks.find((b) => b.code === code)?.name ?? code;
const terminal = (s: string) =>
  ["successful", "failed", "reversed"].includes(s);
async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Request failed");
  return d;
}
function Badge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    draft: "Draft",
    awaiting_beneficiary_verification: "Needs verification",
    awaiting_user_approval: "Needs your approval",
    approved: "Approved",
    submitted: "Submitted · unresolved",
    processing: "Processing · unresolved",
    successful: "Successful",
    failed: "Failed",
    reversed: "Reversed",
    unknown: "Unknown · needs follow-up",
    awaiting_otp: "Awaiting provider OTP",
  };
  const Icon =
    status === "successful"
      ? Check
      : status === "failed"
        ? CircleX
        : status === "reversed"
          ? Undo2
          : status === "unknown"
            ? CircleAlert
            : status === "awaiting_otp"
              ? KeyRound
              : status === "approved"
                ? ShieldCheck
                : status === "awaiting_user_approval"
                  ? LockKeyhole
                  : status === "awaiting_beneficiary_verification"
                    ? Search
                    : Clock3;
  return (
    <span className={`badge ${status}`}>
      <Icon size={14} aria-hidden="true" />
      {labels[status] ?? label(status)}
    </span>
  );
}
function operationProgress(key: string, fixture: boolean, aiEnabled: boolean) {
  const operation = key.split("-")[0];
  const messages: Record<string, string> = {
    chat: aiEnabled ? "Thinking…" : "Preparing a demo response…",
    image: "Extracting details from your image…",
    save: "Saving your payment draft…",
    verify: fixture
      ? "Checking fictional recipient details…"
      : "Verifying recipient details…",
    approve: "Checking your approval…",
    execute: fixture
      ? "Submitting simulated transfers…"
      : "Submitting reviewed transfers…",
    reconcile: fixture
      ? "Checking simulated transfer outcomes…"
      : "Checking provider outcomes…",
    otp: "Checking your OTP submission…",
    emergency: "Updating the transfer stop…",
    login: "Signing you in…",
    logout: "Signing you out…",
  };
  return messages[operation] ?? "Updating your saved workspace…";
}
export function Dashboard({ paymentMode }: { paymentMode: "fixture" | "test" | "live" }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [pendingMessage, setPendingMessage] = useState<{
    text: string;
    after: number;
    status: "pending" | "failed";
  }>();
  const [showLatest, setShowLatest] = useState(false);
  const operationInFlight = useRef(false);
  const snapshotRequest = useRef(0);
  const followLatest = useRef(true);
  const responseAnchor = useRef<string | undefined>(undefined);
  const appRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState("Agent");
  const [menuOpen, setMenuOpen] = useState(false);
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<{ batchId?: string; rows: Row[] }>();
  const uploadInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async (throwOnError = false) => {
    const request = ++snapshotRequest.current;
    try {
      const snapshot = await api<Snapshot>("state");
      if (request !== snapshotRequest.current) return;
      setState(snapshot);
      setSignedOut(false);
    } catch (e) {
      if (request !== snapshotRequest.current && !throwOnError) return;
      const text = e instanceof Error ? e.message : "Unable to load workspace";
      if (/Sign in|expired/.test(text)) {
        setSignedOut(true);
        setState(null);
      } else if (!throwOnError) setError(text);
      if (throwOnError) throw e;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!operationInFlight.current) void refresh();
    }, 20000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (state && banks.length === 0)
      api<typeof banks>("banks")
        .then(setBanks)
        .catch((e) => setError(e.message));
  }, [state, banks.length]);
  const authenticated = state !== null;
  useEffect(() => {
    const viewport = window.visualViewport;
    const keepFocusedVisible = () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        conversationRef.current?.contains(focused)
      )
        focused.scrollIntoView({ block: "nearest" });
      else if (
        focused === composerInput.current &&
        followLatest.current &&
        conversationRef.current
      )
        conversationRef.current.scrollTop =
          conversationRef.current.scrollHeight;
    };
    const update = () => {
      appRef.current?.style.setProperty(
        "--chat-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      appRef.current?.style.setProperty(
        "--chat-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
      keepFocusedVisible();
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    const observer = new ResizeObserver(keepFocusedVisible);
    if (conversationRef.current) observer.observe(conversationRef.current);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [authenticated, tab]);
  useLayoutEffect(() => {
    const input = composerInput.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
    }
  }, [message, authenticated]);
  useLayoutEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (editor) {
      const cards = conversation.querySelectorAll(".proposal-card");
      cards.item(cards.length - 1)?.scrollIntoView({ block: "start" });
    } else if (responseAnchor.current) {
      const response = document.getElementById(
        `message-${responseAnchor.current}`,
      );
      if (response) {
        response.scrollIntoView({ block: "start" });
        followLatest.current = false;
        responseAnchor.current = undefined;
      }
    } else if (followLatest.current)
      conversation.scrollTop = conversation.scrollHeight;
  }, [state?.messages.length, pendingMessage?.status, editor, tab]);
  async function run(
    key: string,
    fn: () => Promise<unknown>,
    onSuccess?: () => void,
  ) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(key);
    setError("");
    setAnnouncement("");
    setProgress(
      operationProgress(key, state?.mode === "fixture", !!state?.aiEnabled),
    );
    try {
      await fn();
      if (key !== "logout") {
        setProgress(
          key === "chat"
            ? "Loading the saved response…"
            : "Refreshing saved workspace details…",
        );
        await refresh(true);
      }
      onSuccess?.();
    } catch (e) {
      if (key === "chat") responseAnchor.current = undefined;
      setError(
        e instanceof TypeError || e instanceof SyntaxError
          ? "The response could not be confirmed. Your input is preserved. Check the conversation before sending again."
          : e instanceof Error
            ? e.message
            : "The response could not be confirmed. Your input has been kept.",
      );
    } finally {
      operationInFlight.current = false;
      setBusy("");
      setProgress("");
    }
  }
  async function send(text: string) {
    if (!text.trim() || operationInFlight.current) return;
    followLatest.current = true;
    const submittedText = text.trim();
    setPendingMessage({
      text: submittedText,
      after: state?.messages.length ?? 0,
      status: "pending",
    });
    setMessage((current) => current || text);
    composerInput.current?.focus({ preventScroll: true });
    let confirmed = false;
    await run(
      "chat",
      async () => {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify({ message: submittedText }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(
            data.error ??
              "The assistant is unavailable. Your input is preserved.",
          );
        }
        const reader = res.body?.getReader();
        if (!reader) throw new TypeError("Missing response");
        const decoder = new TextDecoder();
        let buffer = "";
        let response: { messageId: string } | undefined;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const event = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (event.error) throw new Error(event.error);
            if (event.activity) setProgress(event.activity);
            if (event.result) response = event.result;
          }
        }
        if (!response) throw new TypeError("Unconfirmed response");
        responseAnchor.current = response.messageId;
      },
      () => {
        confirmed = true;
        setMessage((current) => (current === text ? "" : current));
        setAnnouncement(
          "Response received. Your saved conversation has been updated.",
        );
      },
    );
    if (confirmed) setPendingMessage(undefined);
    else
      setPendingMessage((current) =>
        current ? { ...current, status: "failed" } : current,
      );
  }
  function jumpToLatest() {
    followLatest.current = true;
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setShowLatest(false);
  }
  function navigate(next: string) {
    setTab(next);
    setMenuOpen(false);
  }
  function edit(b: ViewBatch) {
    setTab("Agent");
    setEditor({
      batchId: b.id,
      rows: b.payments.map((p) => ({
        name: p.name,
        bankCode: p.bankCode,
        accountNumber: p.accountNumber,
        amountNaira: (p.amountKobo / 100).toFixed(2),
        reason: p.reason,
      })),
    });
  }
  async function upload(file: File) {
    if (!state?.aiEnabled) {
      setError(
        "Image extraction needs a server-configured OpenAI or Gemini model. You can paste payment details into the conversation or enter them in a payment card.",
      );
      return;
    }
    await run("image", async () => {
      const form = new FormData();
      form.set("image", file);
      const r = await fetch("/api/extract", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
    });
  }
  if (!state)
    return (
      <main className="login-shell">
        <div className="login-card">
          <header className="login-header">
            <div className="brand-row">
              <span className="agus-wordmark" aria-label="agus.">agus.</span>
              <div className="demo-pill" role="status">
                <span className="demo-dot" aria-hidden="true" />
                <span>{paymentMode === "fixture" ? "Demo Access" : paymentMode === "test" ? "Test Access" : "Live Access"}</span>
              </div>
            </div>
            <h1 className="login-title">
              Vigilant financial intelligence.
            </h1>
            <p className="login-subtitle">
              Agus safeguards Nigerian business transfers with continuous review and operator oversight.
            </p>
          </header>

          <div className="demo-notice" role="note">
            <ShieldCheck size={16} className="demo-notice-icon" aria-hidden="true" />
            <div className="demo-notice-text">
              <strong>{paymentMode === "fixture" ? "Demo Operator Portal" : paymentMode === "test" ? "Paystack Test Portal" : "Live Operator Portal"}</strong>
              <span>{paymentMode === "fixture"
                ? "Transactions use local fixture simulation. No real funds move."
                : paymentMode === "test"
                  ? "Transactions use Paystack test mode. No real funds move."
                  : "Live payment mode is configured. Transfers can move real funds only when all server safeguards permit them; operator review and authorization are required."}</span>
            </div>
          </div>

          {error && (
            <div className="login-alert" role="alert">
              <CircleAlert size={16} className="alert-icon" aria-hidden="true" />
              <div className="login-alert-body">
                <strong>Authentication Notice</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="alert-dismiss"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          )}

          {signedOut ? (
            <form
              className="login-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!password.trim()) {
                  setValidationError("Please enter your operator password to continue.");
                  return;
                }
                setValidationError("");
                void run("login", async () => {
                  await api("session", { password });
                  setPassword("");
                  setShowPassword(false);
                });
              }}
            >
              <div className="field-group">
                <label htmlFor="operator-password" className="field-label">
                  Operator password
                </label>
                <div className="password-input-wrapper">
                  <input
                    id="operator-password"
                    required
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    placeholder="Enter operator password"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (validationError) setValidationError("");
                      if (error) setError("");
                    }}
                    disabled={busy === "login"}
                    className={`password-input ${validationError ? "input-has-error" : ""}`}
                    aria-invalid={!!validationError}
                    aria-describedby={validationError ? "operator-password-error" : undefined}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                    disabled={busy === "login"}
                  >
                    {showPassword ? (
                      <EyeOff size={18} aria-hidden="true" />
                    ) : (
                      <Eye size={18} aria-hidden="true" />
                    )}
                  </button>
                </div>
                {validationError && (
                  <p id="operator-password-error" className="field-error" role="alert">
                    <CircleAlert size={13} aria-hidden="true" />
                    <span>{validationError}</span>
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="primary full login-submit-btn"
                disabled={!!busy}
              >
                {busy === "login" ? (
                  <>
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                    <span>Signing you in…</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Sign in securely</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="login-connecting" role="status" aria-live="polite">
              <Loader2 size={20} className="spin" aria-hidden="true" />
              <span>Connecting to Agus workspace…</span>
            </div>
          )}

          <details className="setup-note">
            <summary>
              <KeyRound size={14} aria-hidden="true" />
              <span>First-time operator setup</span>
              <ChevronRight size={13} className="disclosure-chevron" aria-hidden="true" />
            </summary>
            <div className="setup-body">
              <p>
                Configure <code>OPERATOR_PASSWORD_HASH</code> with:
              </p>
              <pre><code>npm run operator:password</code></pre>
              <p className="subtle">
                Passwords use scrypt hashing with a 16-byte cryptographically random salt. No password is built in.
              </p>
            </div>
          </details>

          <footer className="login-footer">
            <div className="footer-meta">
              <span className="footer-wordmark">agus.</span>
              <span className="footer-separator">·</span>
              <span className="footer-label">Agus</span>
              <span className="footer-tag">Hackaholics 7.0</span>
            </div>
            <p className="footer-security">
              Manual draft preparation is available without AI credentials.
            </p>
          </footer>
        </div>
      </main>
    );
  const pending = state.batches.filter((b) =>
    b.payments.some((p) => !terminal(p.status)),
  );
  const savedPayments = state.batches.flatMap((b) => b.payments);
  const renderBatch = (b: ViewBatch) => {
    const card = (
      <BatchCard
        key={`${b.id}:${b.reviewDigest}`}
        batch={b}
        banks={banks}
        busy={!!busy}
        run={run}
        edit={() => edit(b)}
        mode={state.mode}
        stopped={state.emergencyDisabled}
      />
    );
    return tab === "Agent" ? (
      <details className="compact-payment" key={b.id}>
        <summary>
          <span>
            <strong>
              {b.payments.map((p) => p.verifiedName ?? p.name).join(", ")}
            </strong>
            <small>
              {money(b.payments.reduce((n, p) => n + p.amountKobo, 0))} before
              fees · {b.mode === "fixture" ? "Simulation" : b.mode} ·{" "}
              {label(b.status)}
            </small>
          </span>
          <span className="detail-action">
            Review details <ChevronRight size={15} />
          </span>
        </summary>
        {card}
      </details>
    ) : (
      card
    );
  };
  const linked = new Set(state.messages.map((m) => m.batchId).filter(Boolean));
  const proposals = (m: Message) =>
    (m.proposals ?? []).map((p) => ({
      ...p,
      bankCode: p.bankCode ?? "",
      accountNumber: p.accountNumber ?? "",
      amountNaira: p.amountNaira ?? "",
    }));
  const editorProps = {
    banks,
    busy: !!busy,
    fixtures: state.fixtureBeneficiaries,
    maxPaymentKobo: state.maxPaymentKobo,
    maxBatchKobo: state.maxBatchKobo,
  };
  return (
    <div
      ref={appRef}
      className={`app-shell ${tab === "Agent" ? "chat-active" : ""} ${state.messages.length || pendingMessage || editor ? "chat-started" : "chat-welcome"}`}
    >
      <aside
        id="workspace-navigation"
        className={`sidebar ${menuOpen ? "menu-open" : ""}`}
      >
        <Link className="brand" href="/">
          <span className="agus-wordmark">agus.</span>
          <span className="brand-caption">Your financial workspace</span>
        </Link>
        <p className="workspace-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {[
            { name: "Agent", icon: MessageSquare },
            { name: "Payment jobs", icon: LayoutDashboard },
            { name: "Activity", icon: Activity },
            { name: "Insights", icon: Wallet },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() => navigate(name)}
              className={`nav-item ${tab === name ? "active" : ""}`}
              aria-label={name}
              aria-current={tab === name ? "page" : undefined}
            >
              <Icon size={18} />
              {name === "Payment jobs" ? "Payment history" : name}
              {name === "Payment jobs" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="secondary new-payment"
          onClick={() => {
            navigate("Agent");
            setEditor({ rows: [blank()] });
          }}
        >
          <Plus size={16} /> New payment details
        </button>
        <button
          className="text-button emergency-control"
          disabled={!!busy}
          onClick={() =>
            void run("emergency", () =>
              api("emergency", { disabled: !state.emergencyDisabled }),
            )
          }
        >
          <ShieldCheck size={16} />
          {state.emergencyDisabled ? "Enable transfers" : "Emergency stop"}
        </button>
        <div className="sidebar-bottom">
          <div className="safety-card">
            <ShieldCheck size={22} />
            <strong>You stay in control</strong>
            <p>
              Agus prepares.
              <br />
              You review and authorize.
            </p>
          </div>
          <p className="muted">Hackaholics 7.0 prototype</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={21} />
            </button>
            <strong>
              {tab === "Agent" ? (
                <span className="agus-wordmark topbar-wordmark">agus.</span>
              ) : tab === "Payment jobs" ? (
                "Payment history"
              ) : (
                tab
              )}
            </strong>
          </div>
          <div className="header-actions">
            <button
              className="sign-out"
              disabled={!!busy}
              onClick={() =>
                void run("logout", async () => {
                  await api("session", undefined, "DELETE");
                  setState(null);
                  setSignedOut(true);
                  setEditor(undefined);
                  setMessage("");
                  setTab("Agent");
                  setMenuOpen(false);
                })
              }
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </header>
        <main className="content">
          {tab !== "Agent" && (
            <div className="page-heading">
              <div>
                <h1>
                  {tab === "Payment jobs"
                    ? "Your payments, in one place."
                    : tab === "Activity"
                      ? "Every step, recorded."
                      : "Understand your spending."}
                </h1>
                <p className="muted">
                  {tab === "Payment jobs"
                    ? "Review saved details and follow individual outcomes."
                    : tab === "Insights"
                      ? "Calculated from a fictional demonstration ledger."
                      : "Saved transfer history and audit records."}
                </p>
              </div>
              <button className="secondary" onClick={() => navigate("Agent")}>
                <MessageSquare size={16} /> Back to conversation
              </button>
            </div>
          )}
          <div className="context-bar">
            <details className="simulation-disclosure">
              <summary>
                <ShieldCheck size={14} />
                <span>
                  {state.mode === "fixture"
                    ? "Simulation · no real money"
                    : `${state.mode} mode · review required`}
                </span>
                <ChevronRight size={12} />
              </summary>
              <p>
                {state.mode === "fixture"
                  ? "Fictional recipients and simulated outcomes. No real accounts are verified and no funds move."
                  : "Transfers use the authorized business balance. Review all details before approval."}
              </p>
            </details>
            <span
              className="model-status"
              title={
                state.aiEnabled
                  ? "A provider is configured. Only a successful response is labelled model-assisted."
                  : "Limited demonstration command parser; no model calls are made."
              }
            >
              {state.aiEnabled
                ? `${state.aiProvider === "openai" ? "OpenAI" : "Gemini"} configured`
                : "Demo · no AI"}
            </span>
          </div>
          {state.emergencyDisabled && (
            <div className="alert" role="status">
              Emergency stop is active. Submission and OTP finalization are
              disabled.
            </div>
          )}
          {error && tab !== "Agent" && (
            <div className="alert" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {tab === "Agent" && (
            <section className="chat-panel" aria-label="Financial conversation">
              <div
                className="conversation"
                ref={conversationRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  followLatest.current = nearBottom;
                  setShowLatest(!nearBottom);
                }}
                role="log"
                aria-live="off"
                aria-label="Conversation messages"
              >
                {pending.length > 0 && (
                  <details className="unfinished">
                    <summary>
                      <Clock3 size={16} /> {pending.length} unfinished payment
                      batch{pending.length === 1 ? "" : "es"} to follow up
                    </summary>
                    <p>
                      These are saved records. Processing or unknown means the
                      outcome is unresolved. Check the provider before further
                      action.
                    </p>
                    {pending.map((b) => (
                      <button
                        key={b.id}
                        className="task-preview"
                        onClick={() =>
                          document
                            .getElementById(`batch-${b.id}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            })
                        }
                      >
                        <span>
                          <strong>
                            {b.payments
                              .map((p) => p.verifiedName ?? p.name)
                              .join(", ")}
                          </strong>
                          <small>
                            {label(b.status)} ·{" "}
                            {money(
                              b.payments.reduce((n, p) => n + p.amountKobo, 0),
                            )}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </details>
                )}
                {state.messages.length === 0 && !pendingMessage && !editor && (
                  <div className="welcome">
                    <span className="welcome-identity" aria-hidden="true">
                      agus.
                    </span>
                    <h1>What can I help you take care of?</h1>
                    <p>
                      Plan a payment, follow a transfer, or make sense of your
                      spending.
                    </p>
                  </div>
                )}
                {state.messages.map((m) => (
                  <div className="conversation-turn" key={m.id}>
                    <article
                      id={`message-${m.id}`}
                      className={`message ${m.role}`}
                    >
                      <small>
                        {m.role === "user" ? "You" : "Agus"}
                        {m.role === "assistant" && (
                          <span className="generation">
                            {m.generation === "model"
                              ? "Model-assisted"
                              : m.generation === "manual"
                                ? "Your details"
                                : "Demo parser"}
                          </span>
                        )}
                      </small>
                      <p>
                        {m.content.replace(
                          /^\[Demonstration command parser — no AI model connected\]\n/,
                          "",
                        )}
                      </p>
                      <time>{date(m.at)}</time>
                    </article>
                    {m.role === "assistant" &&
                    m.proposals?.length &&
                    !m.batchId &&
                    !m.supersededBy ? (
                      <details className="compact-payment proposal-summary">
                        <summary>
                          <span>
                            <strong>
                              {m.proposals
                                .map((p) => p.name || "Recipient needed")
                                .join(", ")}
                            </strong>
                            <small>
                              {m.proposals.every((p) => p.amountNaira)
                                ? `₦${m.proposals.map((p) => p.amountNaira).join(" + ₦")} · `
                                : "Amount needed · "}
                              {m.proposals.length} recipient
                              {m.proposals.length === 1 ? "" : "s"} · Unverified
                              proposal
                              {m.proposals.some((p) => !p.accountNumber)
                                ? " · Account needed"
                                : ""}
                            </small>
                          </span>
                          <span className="detail-action">
                            Edit details <ChevronRight size={15} />
                          </span>
                        </summary>
                        <PaymentEditor
                          key={m.id}
                          {...editorProps}
                          initialRows={proposals(m)}
                          sourceRequest={m.sourceRequest}
                          sourceMessageId={m.id}
                          onSave={(payments) =>
                            run("save", () =>
                              api("batches", {
                                payments,
                                sourceMessageId: m.id,
                              }),
                            )
                          }
                        />
                      </details>
                    ) : null}
                    {m.batchId &&
                      state.batches.find((b) => b.id === m.batchId) && (
                        <div id={`batch-${m.batchId}`} className="linked-batch">
                          <p className="request-link">
                            <MessageSquare size={14} /> From your request: “
                            {m.sourceRequest ?? "Payment request"}”
                          </p>
                          {renderBatch(
                            state.batches.find((b) => b.id === m.batchId)!,
                          )}
                        </div>
                      )}
                  </div>
                ))}
                {state.batches
                  .filter((b) => !linked.has(b.id))
                  .map((b) => (
                    <div
                      id={`batch-${b.id}`}
                      className="linked-batch"
                      key={b.id}
                    >
                      <p className="request-link">
                        Saved payment · continue your review here
                      </p>
                      {renderBatch(b)}
                    </div>
                  ))}
                {editor && (
                  <PaymentEditor
                    key={editor.batchId ?? "manual"}
                    {...editorProps}
                    initialRows={editor.rows}
                    editing={!!editor.batchId}
                    onCancel={() => setEditor(undefined)}
                    onSave={(payments) =>
                      run("save", async () => {
                        await api(
                          editor.batchId
                            ? `batches/${editor.batchId}/edit`
                            : "batches",
                          { payments },
                        );
                        setEditor(undefined);
                      })
                    }
                  />
                )}
                {pendingMessage &&
                  !state.messages
                    .slice(pendingMessage.after)
                    .some(
                      (m) =>
                        m.role === "user" && m.content === pendingMessage.text,
                    ) && (
                    <article
                      className={`message user local-message ${pendingMessage.status}`}
                    >
                      <small>
                        You{" "}
                        <span>
                          {pendingMessage.status === "failed"
                            ? "Response not confirmed"
                            : "Response pending"}
                        </span>
                      </small>
                      <p>{pendingMessage.text}</p>
                      {pendingMessage.status === "failed" && (
                        <p className="muted">
                          Your input is preserved. Check the conversation before
                          sending again.
                        </p>
                      )}
                    </article>
                  )}
              </div>
              <div className="composer-dock">
                {showLatest && (
                  <button
                    className="latest-messages secondary"
                    onClick={jumpToLatest}
                  >
                    <ArrowDownLeft size={15} /> Latest messages
                  </button>
                )}
                {error && (
                  <div className="alert chat-error" role="alert">
                    <span>{error}</span>
                    <button
                      aria-label="Dismiss error"
                      onClick={() => setError("")}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
                <p
                  className={busy ? "request-progress" : "sr-only"}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {busy && (
                    <span className="activity-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {progress || announcement}
                </p>
                <form
                  className="composer"
                  aria-busy={busy === "chat" || busy === "image"}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(message);
                  }}
                >
                  <textarea
                    ref={composerInput}
                    enterKeyHint="enter"
                    autoCapitalize="sentences"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell me what you’d like to do…"
                    aria-label="Message Agus"
                    aria-describedby="composer-shortcuts"
                    rows={2}
                    maxLength={4000}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing &&
                        e.keyCode !== 229 &&
                        !window.matchMedia(
                          "(pointer: coarse), (max-width: 700px)",
                        ).matches
                      ) {
                        e.preventDefault();
                        void send(message);
                      }
                    }}
                  />
                  <div>
                    <button
                      type="button"
                      className="upload-button"
                      disabled={!!busy}
                      onClick={() =>
                        state.aiEnabled
                          ? uploadInput.current?.click()
                          : setError(
                              "Image extraction requires server-side AI configuration. You can paste details in chat or use New payment details without a model.",
                            )
                      }
                    >
                      <Paperclip size={18} /> Attach image
                    </button>
                    <input
                      ref={uploadInput}
                      type="file"
                      hidden
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Attach payment image"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      className="send-button"
                      disabled={!!busy || !message.trim()}
                      aria-label="Send message"
                    >
                      <ArrowRight size={20} />
                    </button>
                  </div>
                </form>
                {state.messages.length === 0 && !pendingMessage && !editor && (
                  <div className="suggestions">
                    {[
                      {
                        title: "Supplier payments",
                        detail: "Start with who and how much",
                        text: "Pay my bills",
                        icon: Send,
                      },
                      {
                        title: "Pending transfers",
                        detail: "Pick up where you left off",
                        text: "What payments are still pending?",
                        icon: Clock3,
                      },
                      {
                        title: "Spending",
                        detail: "Explore the fictional demo ledger",
                        text: "Review my spending",
                        icon: Wallet,
                      },
                    ].map(({ title, text, icon: Icon }) => (
                      <button
                        disabled={!!busy}
                        key={title}
                        onClick={() => void send(text)}
                      >
                        <Icon size={19} />
                        <strong>{title}</strong>
                      </button>
                    ))}
                  </div>
                )}
                <p id="composer-shortcuts" className="sr-only">
                  On desktop, Enter sends and Shift+Enter adds a line. On
                  mobile, Enter adds a line; use the Send message button to
                  send.
                </p>
                <p className="chat-footnote">
                  <ShieldCheck size={13} />
                  Every payment needs your review and approval.
                </p>
              </div>
            </section>
          )}
          {tab !== "Agent" && busy && (
            <p className="request-progress" role="status">
              {progress}
            </p>
          )}
          {tab === "Payment jobs" && (
            <div className="job-list">
              {state.batches.length ? (
                state.batches.map((b) => (
                  <div key={b.id}>
                    <p className="request-link">
                      {state.messages.find((m) => m.batchId === b.id)
                        ?.sourceRequest ?? "Saved payment details"}
                    </p>
                    {renderBatch(b)}
                  </div>
                ))
              ) : (
                <div className="panel empty-state">
                  <MessageSquare size={28} />
                  <h2>Your next payment starts with a conversation.</h2>
                  <button className="primary" onClick={() => navigate("Agent")}>
                    Talk to Agus <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === "Activity" && (
            <>
              <div className="section-heading">
                <h2>
                  Saved transfers{" "}
                  <span className="subtle">{savedPayments.length} records</span>
                </h2>
                <a className="secondary" href="/api/reports" download>
                  <FileDown size={16} />
                  Export CSV
                </a>
              </div>
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Beneficiary / reference</th>
                      <th>Amount</th>
                      <th>Environment</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.batches.flatMap((b) =>
                      b.payments.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.verifiedName ?? p.name}</strong>
                            <details className="payment-reference">
                              <summary>Payment reference</summary>
                              <code>{p.reference}</code>
                            </details>
                          </td>
                          <td>{money(p.amountKobo)}</td>
                          <td>
                            {b.mode === "fixture" ? "Simulation" : b.mode}
                          </td>
                          <td>
                            <Badge status={p.status} />
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
                {!state.batches.some((b) => b.payments.length) && (
                  <p className="empty-small">No saved transfers yet.</p>
                )}
              </div>
              <h2 className="section-title">Audit trail</h2>
              <div className="panel audit-list">
                {[...state.audit].reverse().map((a) => (
                  <details key={a.id}>
                    <summary>
                      <span className="audit-dot" />
                      <strong>{label(a.action.replaceAll(".", " · "))}</strong>
                      <span>{a.actor}</span>
                      <time>{date(a.at)}</time>
                    </summary>
                    <pre>{JSON.stringify(a.details, null, 2)}</pre>
                  </details>
                ))}
                {!state.audit.length && (
                  <p className="empty-small">Actions will be recorded here.</p>
                )}
              </div>
            </>
          )}
          {tab === "Insights" && (
            <>
              <div className="notice">
                <Wallet size={16} />
                Fictional seeded history. Paystack payout access does not
                provide personal-bank transactions.
              </div>
              <div className="stats-grid">
                <div className="stat">
                  <span>Total income · seeded period</span>
                  <strong>{money(state.insights.incomeKobo)}</strong>
                  <small>Fictional credits</small>
                </div>
                <div className="stat">
                  <span>This week’s spending</span>
                  <strong>{money(state.insights.weeklyKobo)}</strong>
                  <small>
                    Previous week: {money(state.insights.previousWeekKobo)}
                  </small>
                </div>
                <div className="stat">
                  <span>This month’s spending</span>
                  <strong>{money(state.insights.monthlyKobo)}</strong>
                  <small>Fictional debits</small>
                </div>
              </div>
              <div className="insight-grid">
                <section className="panel insight-card">
                  <h2>Spending by category</h2>
                  <p className="muted">
                    Across the fictional demonstration ledger
                  </p>
                  {state.insights.categories.map((c) => (
                    <div className="category" key={c.name}>
                      <div>
                        <span>{c.name}</span>
                        <strong>{money(c.amountKobo)}</strong>
                      </div>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${state.insights.expenseKobo > 0 ? (c.amountKobo / state.insights.expenseKobo) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </section>
                <section className="panel insight-card">
                  <h2>Largest expenses</h2>
                  {state.insights.largest.map((e) => (
                    <div className="ledger-preview" key={e.id}>
                      <span className="task-icon">
                        <ArrowUpRight size={16} />
                      </span>
                      <span>
                        <strong>{e.merchant}</strong>
                        <small>
                          {e.category} · {date(e.at)}
                        </small>
                      </span>
                      <strong>{money(-e.amountKobo)}</strong>
                    </div>
                  ))}
                  <h2 className="section-title">Sample obligation</h2>
                  <p className="muted">
                    Fictional monthly data subscription: ₦5,000. This is a
                    demonstration reminder; no payment is scheduled.
                  </p>
                </section>
              </div>
              <h2 className="section-title">Demonstration ledger</h2>
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date · Lagos</th>
                      <th>Merchant</th>
                      <th>Category</th>
                      <th>Amount</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...state.ledger].reverse().map((e) => (
                      <tr key={e.id}>
                        <td>{date(e.at)}</td>
                        <td>
                          {e.merchant}
                          {e.recurring && (
                            <small className="block subtle">Recurring</small>
                          )}
                        </td>
                        <td>{e.category}</td>
                        <td className={e.amountKobo > 0 ? "positive" : ""}>
                          {e.amountKobo > 0 ? (
                            <ArrowDownLeft size={12} />
                          ) : (
                            <ArrowUpRight size={12} />
                          )}{" "}
                          {money(e.amountKobo)}
                        </td>
                        <td>{money(e.balanceKobo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function PaymentEditor({
  initialRows,
  banks,
  fixtures,
  busy,
  sourceRequest,
  sourceMessageId,
  editing,
  onSave,
  onCancel,
  maxPaymentKobo,
  maxBatchKobo,
}: {
  initialRows: Row[];
  banks: { name: string; code: string }[];
  fixtures: Snapshot["fixtureBeneficiaries"];
  busy: boolean;
  sourceRequest?: string;
  sourceMessageId?: string;
  editing?: boolean;
  onSave: (payments: Instruction[]) => Promise<void>;
  onCancel?: () => void;
  maxPaymentKobo: number;
  maxBatchKobo: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const edits = useRef<Promise<unknown>>(Promise.resolve());
  const persist = async (inputRows: Row[] = rows) => {
    if (!sourceMessageId || busy) return;
    const snapshot = inputRows.map((r) => ({
      ...r,
      bankCode: r.bankCode || null,
      accountNumber: r.accountNumber || null,
      amountNaira: r.amountNaira || null,
      confidence: "medium",
      warnings: r.warnings ?? [],
    }));
    try {
      const pending = edits.current.then(() =>
        api(`proposals/${sourceMessageId}`, {
          proposals: snapshot,
        }),
      );
      edits.current = pending.catch(() => undefined);
      await pending;
      setDraftStatus("Changes saved");
    } catch (e) {
      setDraftStatus(e instanceof Error ? e.message : "Could not save changes");
    }
  };
  function update(i: number, key: keyof Row, value: string) {
    setDraftStatus("");
    setRows(rows.map((r, j) => (i === j ? { ...r, [key]: value } : r)));
  }
  return (
    <section
      className="panel proposal-card"
      aria-label={editing ? "Edit payment details" : "Payment proposal"}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {editing ? "EDIT PAYMENT DETAILS" : "PAYMENT PROPOSAL · UNVERIFIED"}
          </p>
          <h2>
            {editing ? "Update your instructions" : "Let’s fill in the details"}
          </h2>
        </div>
        {onCancel && (
          <button aria-label="Close payment details" onClick={onCancel}>
            <X size={19} />
          </button>
        )}
      </div>
      {sourceRequest && (
        <p className="request-link">From your request: “{sourceRequest}”</p>
      )}
      <p className="muted">
        Missing details stay empty. Saving creates an unverified draft.{" "}
        {editing && "Editing invalidates verification and approval."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            const payments = rows.map((r) => {
              if (!/^\d+(\.\d{1,2})?$/.test(r.amountNaira))
                throw new Error(
                  "Enter an amount with at most two decimal places.",
                );
              const [a, b = ""] = r.amountNaira.split(".");
              return {
                name: r.name,
                bankCode: r.bankCode,
                accountNumber: r.accountNumber,
                amountKobo: Number(a) * 100 + Number(b.padEnd(2, "0")),
                reason: r.reason,
              };
            });
            void edits.current.then(() => onSave(payments));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Review the details");
          }
        }}
      >
        {rows.map((r, i) => (
          <fieldset className="recipient-form" key={i} disabled={busy}>
            <legend>Recipient {i + 1}</legend>
            <div className="section-heading">
              <span className="muted">
                {r.name || "Who would you like to pay?"}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove recipient ${i + 1}`}
                  onClick={() => {
                    const next = rows.filter((_, j) => i !== j);
                    setRows(next);
                    void persist(next);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            {fixtures.length > 0 && (
              <label className="fixture-select">
                Use fictional demo details (optional)
                <select
                  aria-label={`Fictional recipient ${i + 1}`}
                  onBlur={() => void persist()}
                  value=""
                  onChange={(e) => {
                    const f = fixtures.find(
                      (f) => f.accountNumber === e.target.value,
                    );
                    if (f) {
                      setRows(
                        rows.map((row, j) =>
                          j === i ? { ...row, ...f } : row,
                        ),
                      );
                      setDraftStatus("");
                    }
                  }}
                >
                  <option value="">Choose a fictional recipient</option>
                  {fixtures.map((f) => (
                    <option key={f.accountNumber} value={f.accountNumber}>
                      {f.name} · {f.accountNumber}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-grid">
              {[
                {
                  key: "name",
                  title: "Recipient label",
                  hint: "Who should be paid?",
                  length: 100,
                },
                {
                  key: "accountNumber",
                  title: "Account number",
                  hint: "10 digits required",
                  length: 10,
                },
                {
                  key: "amountNaira",
                  title: "Amount (NGN)",
                  hint: "Amount required",
                  length: 16,
                },
                {
                  key: "reason",
                  title: "Description",
                  hint: "What is it for?",
                  length: 140,
                },
              ].map(({ key, title, hint, length }) => (
                <label key={key}>
                  {title}
                  <input
                    required={key !== "reason"}
                    maxLength={length}
                    pattern={
                      key === "accountNumber"
                        ? "[0-9]{10}"
                        : key === "amountNaira"
                          ? "[0-9]+(\\.[0-9]{1,2})?"
                          : undefined
                    }
                    inputMode={
                      key === "accountNumber"
                        ? "numeric"
                        : key === "amountNaira"
                          ? "decimal"
                          : undefined
                    }
                    value={r[key as keyof Row] as string}
                    placeholder={hint}
                    onChange={(e) =>
                      update(i, key as keyof Row, e.target.value)
                    }
                    onBlur={() => void persist()}
                  />
                </label>
              ))}
              <label>
                Bank
                <select
                  required
                  aria-label="Bank"
                  value={r.bankCode}
                  onBlur={() => void persist()}
                  onChange={(e) => update(i, "bankCode", e.target.value)}
                >
                  <option value="">Bank required</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {r.warnings?.length ? (
              <details className="field-warning">
                <summary>Extraction notes · review carefully</summary>
                {r.warnings.map((w, j) => (
                  <p key={j}>{w}</p>
                ))}
              </details>
            ) : null}
          </fieldset>
        ))}
        <div className="form-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy || rows.length >= 10}
            onClick={() => {
              const next = [...rows, blank()];
              setRows(next);
              void persist(next);
            }}
          >
            <Plus size={16} /> Add recipient
          </button>
          <button className="primary" disabled={busy}>
            <Check size={16} />
            {editing ? "Save changes" : "Save draft"}
          </button>
        </div>
        <p className="micro">
          Limit {money(maxPaymentKobo)} per payment · {money(maxBatchKobo)} per
          batch. No approval or submission occurs here.
        </p>
        {sourceMessageId && (
          <p className="micro" role="status">
            {draftStatus || "Edits save when you leave a field."}
          </p>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
      </form>
    </section>
  );
}
function BatchCard({
  batch: b,
  banks,
  busy,
  run,
  edit,
  mode,
  stopped,
}: {
  batch: ViewBatch;
  banks: { name: string; code: string }[];
  busy: boolean;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  edit: () => void;
  mode: Mode;
  stopped: boolean;
}) {
  const [password, setPassword] = useState("");
  // The parent remounts this card when reviewDigest changes, clearing secrets too.
  const [acknowledgedDigest, setAcknowledgedDigest] = useState<string>();
  const checked = acknowledgedDigest === b.reviewDigest;
  const [otp, setOtp] = useState("");
  const [otpPayment, setOtpPayment] = useState("");
  const isDraft =
    [
      "awaiting_beneficiary_verification",
      "awaiting_user_approval",
      "approved",
    ].includes(b.status) && !b.approval?.consumedAt;
  const total = b.payments.reduce((n, p) => n + p.amountKobo, 0);
  const action = (op: string, body: unknown = {}) =>
    run(`${op}-${b.id}`, () => api(`batches/${b.id}/${op}`, body));
  return (
    <section className="panel batch-card">
      <div className="batch-heading">
        <div>
          <p className="eyebrow">
            {b.mode === "fixture"
              ? "SIMULATED PAYMENT BATCH"
              : `${b.mode.toUpperCase()} PAYMENT BATCH`}
          </p>
          <h2>
            {b.payments.length} recipient{b.payments.length !== 1 ? "s" : ""}{" "}
            <span className="subtle">· {date(b.createdAt)}</span>
          </h2>
        </div>
        <Badge status={b.status} />
      </div>
      <details className="workflow-guide">
        <summary>Payment steps</summary>
        <ol className="workflow-steps" aria-label="Payment progress">
          {[
            "Details saved",
            "Verify recipients",
            "Your approval",
            "Track outcomes",
          ].map((step, i) => {
            const current = b.approval?.consumedAt
              ? 3
              : b.approval
                ? 2
                : b.payments.every((p) => p.verifiedName)
                  ? 2
                  : 1;
            return (
              <li
                key={step}
                className={
                  i < current ? "done" : i === current ? "current" : ""
                }
              >
                <span>{i < current ? <Check size={12} /> : i + 1}</span>
                {step}
              </li>
            );
          })}
        </ol>
      </details>
      <p className="next-step">
        {b.payments.some((p) =>
          ["unknown", "processing", "submitted"].includes(p.status),
        )
          ? "Some outcomes are still unresolved. Check provider status below; do not send the same payments again."
          : b.payments.some((p) => p.status === "awaiting_otp")
            ? "A provider OTP is required. Review the recipient outcome below."
            : b.payments.every((p) => terminal(p.status))
              ? "Review each recipient’s individual outcome below."
              : b.status === "approved"
                ? "Your approval is recorded. Submit explicitly below when you are ready."
                : b.status === "awaiting_user_approval"
                  ? "Review all verified details, acknowledge them, and approve with your operator password."
                  : "Next, verify the recipient details. You will review them before approving."}
      </p>
      <div className="payment-rows">
        {b.payments.map((p, i) => (
          <div className="payment-row" key={p.id}>
            <div className="recipient-number">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="recipient-details">
              <strong>
                {p.verifiedName ?? p.name}{" "}
                {p.verifiedName && (
                  <ShieldCheck size={14} className="positive" />
                )}
              </strong>
              <span>
                {bankName(p.bankCode, banks)} · {p.accountNumber}
              </span>
              <small>
                {p.verifiedName
                  ? b.mode === "fixture"
                    ? "Fixture name only"
                    : "Provider-resolved beneficiary"
                  : "Awaiting provider verification"}{" "}
                · {p.reason}
              </small>
              <details className="payment-reference">
                <summary>Payment reference</summary>
                <code>{p.reference}</code>
              </details>
              {p.lastError && (
                <span className="payment-error">{p.lastError}</span>
              )}
            </div>
            <div className="payment-value">
              <strong>{money(p.amountKobo)}</strong>
              <Badge status={p.status} />
              {p.providerFeeKobo !== undefined && (
                <small>Confirmed fee: {money(p.providerFeeKobo)}</small>
              )}
              {p.status === "awaiting_otp" && (
                <button
                  className="text-button"
                  onClick={() => setOtpPayment(p.id)}
                >
                  Enter provider OTP
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="batch-total">
        <span>
          Payments <strong>{money(total)}</strong>
        </span>
        <span>
          Fee reserve · estimate{" "}
          <strong>{money(b.feeReserveKobo * b.payments.length)}</strong>
        </span>
        <span className="grand-total">
          Total including reserve{" "}
          <strong>{money(total + b.feeReserveKobo * b.payments.length)}</strong>
        </span>
      </div>
      <p className="micro">
        Fees are a conservative configurable reserve, not a Paystack quote.
        Confirmed provider charges appear when returned.{" "}
        {mode === "fixture" ? "These outcomes simulate transfers only." : ""}
      </p>
      <div className="batch-actions">
        {isDraft && (
          <button className="secondary" disabled={busy} onClick={edit}>
            Edit instructions
          </button>
        )}
        {isDraft && !b.approval && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action("verify")}
          >
            <ShieldCheck size={15} />
            Verify beneficiaries
          </button>
        )}
        {b.status === "awaiting_user_approval" && !b.approval && (
          <form
            className="approval-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!acknowledgedDigest || acknowledgedDigest !== b.reviewDigest)
                return;
              const submittedPassword = password;
              setPassword("");
              void action("approve", {
                password: submittedPassword,
                reviewDigest: acknowledgedDigest,
              });
            }}
          >
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={checked}
                onChange={(e) =>
                  setAcknowledgedDigest(
                    e.target.checked ? b.reviewDigest : undefined,
                  )
                }
              />
              I reviewed the bank, verified name, account, amount and fee
              reserve for every payment.
            </label>
            <div>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Operator password"
                aria-label="Password to approve reviewed batch"
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="primary" disabled={busy || !checked}>
                <ShieldCheck size={15} />
                Approve reviewed batch
              </button>
            </div>
          </form>
        )}
        {b.status === "approved" && (
          <>
            <span className="subtle">
              Approved by {b.approval?.actor} · expires{" "}
              {date(b.approval!.expiresAt)}
            </span>
            <button
              className="primary"
              disabled={busy || stopped}
              onClick={() =>
                void action("execute", { nonce: b.approval?.nonce })
              }
            >
              <Send size={15} />
              {mode === "fixture"
                ? "Submit simulated transfers"
                : "Submit transfers to Paystack"}
            </button>
          </>
        )}
        {b.approval?.consumedAt && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action("reconcile")}
          >
            <RefreshCw size={15} />
            Check provider
          </button>
        )}
      </div>
      {otpPayment && (
        <form
          className="otp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action("otp", { paymentId: otpPayment, otp, password }).then(
              () => {
                setOtp("");
                setPassword("");
                setOtpPayment("");
              },
            );
          }}
        >
          <p>
            Use the OTP sent by Paystack to the legitimate business operator.
            OTPs are never stored.
          </p>
          <input
            required
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Provider OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <input
            required
            type="password"
            autoComplete="current-password"
            aria-label="Operator password for OTP"
            placeholder="Operator password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={busy || stopped}>
            Finalize with OTP
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setOtpPayment("")}
          >
            Cancel
          </button>
        </form>
      )}
      <details className="job-details">
        <summary>Provider responses &amp; approval record</summary>
        <pre>
          {JSON.stringify(
            {
              batchId: b.id,
              approval: b.approval,
              payments: b.payments.map((p) => ({
                reference: p.reference,
                transferCode: p.transferCode,
                responses: p.responses,
              })),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
