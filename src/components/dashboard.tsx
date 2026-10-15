"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Paperclip,
  Sparkles,
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
export function Dashboard() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("Agent");
  const [menuOpen, setMenuOpen] = useState(false);
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<{ batchId?: string; rows: Row[] }>();
  const chatEnd = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      setState(await api<Snapshot>("state"));
      setSignedOut(false);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Unable to load workspace";
      if (/Sign in|expired/.test(text)) {
        setSignedOut(true);
        setState(null);
      } else setError(text);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (state && banks.length === 0)
      api<typeof banks>("banks")
        .then(setBanks)
        .catch((e) => setError(e.message));
  }, [state, banks.length]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state?.messages.length, editor]);
  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }
  async function send(text: string) {
    if (!text.trim() || busy) return;
    await run("chat", async () => {
      await api("chat", { message: text });
      setMessage("");
    });
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
          <div className="brand-mark">
            <Sparkles size={23} />
          </div>
          <p className="eyebrow">FINANCIAL AGENT · HACKAHOLICS 7.0</p>
          <h1>
            Let’s take care of
            <br />
            your next payment.
          </h1>
          <p className="muted">
            A conversation to prepare. A clear review to approve. Sign in as the
            account operator to get started.
          </p>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {signedOut ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("login", async () => {
                  await api("session", { password });
                  setPassword("");
                });
              }}
            >
              <label>
                Operator password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary full" disabled={!!busy}>
                <ShieldCheck size={17} /> Sign in securely{" "}
                <ArrowRight size={17} />
              </button>
            </form>
          ) : (
            <p role="status">
              <Loader2 size={18} className="spin" /> Connecting to saved
              workspace…
            </p>
          )}
          <details className="setup-note">
            <summary>First-time operator setup</summary>
            <p>
              Configure <code>OPERATOR_PASSWORD_HASH</code> with{" "}
              <code>npm run operator:password</code>. See the README. No
              password is built in.
            </p>
          </details>
          <div className="login-footer">
            Financial Agent
            <span>Fixture experience available without AI credentials.</span>
          </div>
        </div>
      </main>
    );
  const pending = state.batches.filter((b) =>
    b.payments.some((p) => !terminal(p.status)),
  );
  const submitted = state.batches
    .flatMap((b) => b.payments)
    .filter((p) =>
      [
        "submitted",
        "processing",
        "successful",
        "failed",
        "reversed",
        "unknown",
        "awaiting_otp",
      ].includes(p.status),
    );
  const renderBatch = (b: ViewBatch) => (
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
    <div className={`app-shell ${tab === "Agent" ? "chat-active" : ""}`}>
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <span>Financial Agent</span>
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
        <div className="sidebar-bottom">
          <div className="safety-card">
            <ShieldCheck size={22} />
            <strong>You stay in control</strong>
            <p>
              The agent prepares.
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
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={21} />
            </button>
            <strong>
              {tab === "Agent"
                ? "Your financial agent"
                : tab === "Payment jobs"
                  ? "Payment history"
                  : tab}
            </strong>
          </div>
          <div className="header-actions">
            <span className="mode-pill">
              {state.mode === "fixture"
                ? "Simulation · no real money"
                : `${state.mode} mode`}
            </span>
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
          <div className="notice">
            <ShieldCheck size={16} />
            <span>
              {state.mode === "fixture"
                ? "Fictional recipients and simulated outcomes. No real accounts verified or funds moved."
                : "Review all payment details before authorizing."}
            </span>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void run("emergency", () =>
                  api("emergency", { disabled: !state.emergencyDisabled }),
                )
              }
            >
              {state.emergencyDisabled ? "Enable transfers" : "Emergency stop"}
            </button>
          </div>
          {state.emergencyDisabled && (
            <div className="alert" role="status">
              Emergency stop is active. Submission and OTP finalization are
              disabled.
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {tab === "Agent" && (
            <section className="chat-panel" aria-label="Financial conversation">
              <div className="model-status">
                <span className="dot" />
                {state.aiEnabled
                  ? `${state.aiProvider === "openai" ? "OpenAI" : "Gemini"} configured · model requests may fail`
                  : "Demo parser · limited commands · no AI model connected"}
              </div>
              <div
                className="conversation"
                role="log"
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
                {state.messages.length === 0 && !editor && (
                  <div className="welcome">
                    <div className="welcome-symbol">
                      <Sparkles size={32} />
                    </div>
                    <p className="eyebrow">
                      A LITTLE HELP WITH YOUR MONEY TASKS
                    </p>
                    <h1>
                      What can I help you
                      <br />
                      take care of?
                    </h1>
                    <p>
                      Prepare a payment, follow up a transfer,
                      <br />
                      or understand your spending. One step at a time.
                    </p>
                    <div className="suggestions">
                      {[
                        {
                          title: "Prepare supplier payments",
                          detail: "Start with who and how much",
                          text: "Pay my bills",
                          icon: Send,
                        },
                        {
                          title: "Upload payment details",
                          detail: "Review a screenshot together",
                          text: "upload",
                          icon: Paperclip,
                        },
                        {
                          title: "Check pending transfers",
                          detail: "Pick up where you left off",
                          text: "What payments are still pending?",
                          icon: Clock3,
                        },
                        {
                          title: "Review my spending",
                          detail: "Explore the fictional demo ledger",
                          text: "Review my spending",
                          icon: Wallet,
                        },
                      ].map(({ title, detail, text, icon: Icon }) => (
                        <button
                          disabled={!!busy}
                          key={title}
                          onClick={() =>
                            text === "upload"
                              ? state.aiEnabled
                                ? uploadInput.current?.click()
                                : setError(
                                    "Image extraction requires a server-configured OpenAI or Gemini API key. Paste payment details into the conversation or select New payment details to continue in demo mode.",
                                  )
                              : void send(text)
                          }
                        >
                          <Icon size={19} />
                          <strong>{title}</strong>
                          <small>{detail}</small>
                          <ArrowUpRight size={15} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {state.messages.map((m) => (
                  <div className="conversation-turn" key={m.id}>
                    <article className={`message ${m.role}`}>
                      <small>
                        {m.role === "user" ? "You" : "Financial Agent"}
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
                      <PaymentEditor
                        key={m.id}
                        {...editorProps}
                        initialRows={proposals(m)}
                        sourceRequest={m.sourceRequest}
                        sourceMessageId={m.id}
                        onSave={(payments) =>
                          run("save", () =>
                            api("batches", { payments, sourceMessageId: m.id }),
                          )
                        }
                      />
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
                {busy && (
                  <p className="working" role="status">
                    <Loader2 className="spin" size={17} />
                    {busy === "chat"
                      ? "Preparing a response…"
                      : busy === "image"
                        ? "Reading your image with the configured model…"
                        : "Updating saved payment state…"}
                  </p>
                )}
                <div ref={chatEnd} />
              </div>
              <div className="composer-dock">
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(message);
                  }}
                >
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell me what you’d like to do…"
                    aria-label="Message the financial agent"
                    rows={2}
                    maxLength={4000}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
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
                <p className="chat-footnote">
                  <ShieldCheck size={13} />
                  You review and approve. The agent cannot authorize or submit.
                </p>
              </div>
            </section>
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
                    Talk to the agent <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === "Activity" && (
            <>
              <div className="section-heading">
                <h2>
                  Transfer history{" "}
                  <span className="subtle">{submitted.length} records</span>
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
                            <code>{p.reference}</code>
                          </td>
                          <td>{money(p.amountKobo)}</td>
                          <td>{b.mode}</td>
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
                  <small>Calculated in integer kobo</small>
                </div>
              </div>
              <div className="insight-grid">
                <section className="panel insight-card">
                  <h2>Spending by category</h2>
                  <p className="muted">All seeded transactions</p>
                  {state.insights.categories.map((c) => (
                    <div className="category" key={c.name}>
                      <div>
                        <span>{c.name}</span>
                        <strong>{money(c.amountKobo)}</strong>
                      </div>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${(c.amountKobo / state.insights.expenseKobo) * 100}%`,
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
            {b.mode.toUpperCase()} PAYMENT JOB · {b.id.slice(0, 8)}
          </p>
          <h2>
            {b.payments.length} recipient{b.payments.length !== 1 ? "s" : ""}{" "}
            <span className="subtle">· {date(b.createdAt)}</span>
          </h2>
        </div>
        <Badge status={b.status} />
      </div>
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
              className={i < current ? "done" : i === current ? "current" : ""}
            >
              <span>{i < current ? <Check size={12} /> : i + 1}</span>
              {step}
            </li>
          );
        })}
      </ol>
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
              <code>{p.reference}</code>
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
              void action("approve", {
                password,
                reviewDigest: acknowledgedDigest,
              }).then(() => setPassword(""));
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
