"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FileDown,
  ImagePlus,
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
import type { Insight, Proposed } from "@/lib/intelligence";
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
  bankCode: "035",
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
  return (
    <span className={`badge ${status}`}>
      {status === "successful" ? <Check size={12} /> : <span className="dot" />}
      {label(status)}
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
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<number>();
  const chatEnd = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    try {
      setState(await api<Snapshot>("state"));
      setSignedOut(false);
    } catch (e) {
      if (e instanceof Error && /Sign in|expired/.test(e.message)) {
        setSignedOut(true);
        setState(null);
      } else setError(String(e instanceof Error ? e.message : e));
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
  }, [state?.messages.length]);
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
  function applyProposals(proposals: Proposed[]) {
    if (!proposals.length) return;
    setRows(
      proposals.map((p) => ({
        name: p.name,
        bankCode: p.bankCode ?? "",
        accountNumber: p.accountNumber ?? "",
        amountNaira: p.amountNaira ?? "",
        reason: p.reason,
        warnings: [
          ...p.warnings,
          ...(p.confidence !== "high"
            ? [`${p.confidence} confidence: review carefully`]
            : []),
        ],
      })),
    );
    setEditing(undefined);
    setShowForm(true);
  }
  async function send(text: string) {
    if (!text.trim()) return;
    await run("chat", async () => {
      const r = await api<{ proposals: Proposed[] }>("chat", { message: text });
      setMessage("");
      applyProposals(r.proposals);
    });
  }
  async function upload(file: File) {
    await run("image", async () => {
      const form = new FormData();
      form.set("image", file);
      const r = await fetch("/api/extract", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      applyProposals(data.proposals);
    });
  }
  async function save() {
    const payments: Instruction[] = rows.map((r) => {
      if (!/^\d+(\.\d{1,2})?$/.test(r.amountNaira))
        throw new Error("Use a positive amount with at most 2 decimals");
      const [a, b = ""] = r.amountNaira.split(".");
      return {
        name: r.name,
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        amountKobo: Number(a) * 100 + Number(b.padEnd(2, "0")),
        reason: r.reason,
      };
    });
    await api(editing ? `batches/${editing}/edit` : "batches", { payments });
    setShowForm(false);
    setRows([blank()]);
    setEditing(undefined);
    setTab("Payment jobs");
  }
  function edit(b: ViewBatch) {
    setRows(
      b.payments.map((p) => ({
        name: p.name,
        bankCode: p.bankCode,
        accountNumber: p.accountNumber,
        amountNaira: (p.amountKobo / 100).toFixed(2),
        reason: p.reason,
      })),
    );
    setEditing(b.id);
    setShowForm(true);
  }
  if (!state)
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand-mark">
            <Wallet size={23} />
          </div>
          <p className="eyebrow">HACKAHOLICS 7.0</p>
          <h1>
            Your financial tasks,
            <br />
            carried through.
          </h1>
          <p className="muted">
            Sign in as the funding-account operator to prepare, review and track
            payments.
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
                {busy ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <ShieldCheck size={17} />
                )}{" "}
                Sign in securely <ArrowRight size={17} />
              </button>
            </form>
          ) : (
            <p>
              <Loader2 size={18} className="spin" /> Connecting to persistent
              storage…
            </p>
          )}
          <div className="setup-note">
            First run? Configure <code>OPERATOR_PASSWORD_HASH</code> using{" "}
            <code>npm run operator:password</code>. See the project README. No
            password is built into the app.
          </div>
          <div className="login-footer">
            CONTINUITY <span>Prepare. Approve. Follow through.</span>
          </div>
        </div>
      </main>
    );
  const pending = state.batches.filter((b) =>
    b.payments.some((p) => !terminal(p.status)),
  );
  const allPayments = state.batches.flatMap((b) => b.payments);
  const submitted = allPayments.filter((p) =>
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
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Wallet size={22} />
          </span>
          <span>
            continuity<span className="brand-period">.</span>
          </span>
        </Link>
        <p className="workspace-label">YOUR WORKSPACE</p>
        <nav>
          {[
            { name: "Agent", icon: MessageSquare },
            { name: "Payment jobs", icon: LayoutDashboard },
            { name: "Activity", icon: Activity },
            { name: "Insights", icon: Wallet },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() => setTab(name)}
              className={`nav-item ${tab === name ? "active" : ""}`}
            >
              <Icon size={18} />
              {name}
              {name === "Payment jobs" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safety-card">
            <ShieldCheck size={21} />
            <strong>You stay in control</strong>
            <p>
              Your agent prepares.
              <br />
              Only you authorize.
            </p>
          </div>
          <div className="operator">
            <div className="avatar">OP</div>
            <div>
              <strong>Account operator</strong>
              <small>Authenticated workspace</small>
            </div>
            <button
              title="Sign out"
              aria-label="Sign out"
              onClick={() =>
                void run("logout", async () => {
                  await api("session", undefined, "DELETE");
                  setState(null);
                  setSignedOut(true);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={13} />
            <strong>{tab}</strong>
          </div>
          <span className={`mode-pill ${state.mode}`}>
            <span className="dot" />
            {state.mode === "fixture"
              ? "Fixture workspace · no real money"
              : state.mode === "test"
                ? "Paystack test mode"
                : "Paystack live mode"}
          </span>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR FINANCIAL WORKSPACE</p>
              <h1>
                {tab === "Agent"
                  ? "A little clarity. A lot done."
                  : tab === "Payment jobs"
                    ? "Every payment, followed through."
                    : tab === "Activity"
                      ? "The record behind every task."
                      : "Know where your money goes."}
              </h1>
              <p className="muted">
                {tab === "Agent"
                  ? "Turn an instruction into a reviewed, trackable financial task."
                  : tab === "Payment jobs"
                    ? "Pick up where you left off. Submitted does not mean successful."
                    : tab === "Activity"
                      ? "Persisted transfer records and an auditable trail."
                      : "Real calculations from a fictional Nigerian transaction ledger."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setRows([blank()]);
                setEditing(undefined);
                setShowForm(true);
              }}
            >
              <Plus size={17} /> Prepare payment
            </button>
          </div>
          <div className="notice">
            <ShieldCheck size={16} />
            <span>
              {state.mode === "fixture"
                ? "Demonstration data and simulated provider outcomes. No real accounts are verified or funds moved."
                : "Transfers originate from the authorized Paystack business balance. No personal bank account is debited."}
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
            <div className="alert">
              Emergency stop is active. Transfer submission and OTP finalization
              are disabled.
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "Agent" && (
            <>
              <div className="stats-grid">
                <div className="stat">
                  <span>
                    <Wallet size={16} />
                    Transfer balance
                  </span>
                  <strong>
                    {balance === undefined ? "—" : money(balance)}
                  </strong>
                  <button
                    className="text-button"
                    onClick={() =>
                      void run("balance", async () =>
                        setBalance(
                          (await api<{ availableKobo: number }>("balance"))
                            .availableKobo,
                        ),
                      )
                    }
                  >
                    {busy === "balance"
                      ? "Checking…"
                      : `Check ${state.mode === "fixture" ? "fixture" : "Paystack"} balance`}{" "}
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <div className="stat">
                  <span>
                    <Clock3 size={16} />
                    Unfinished jobs
                  </span>
                  <strong>{pending.length.toString().padStart(2, "0")}</strong>
                  <button
                    className="text-button"
                    onClick={() => setTab("Payment jobs")}
                  >
                    Continue a task <ArrowRight size={13} />
                  </button>
                </div>
                <div className="stat">
                  <span>
                    <Check size={16} />
                    Successful transfers
                  </span>
                  <strong>
                    {allPayments
                      .filter((p) => p.status === "successful")
                      .length.toString()
                      .padStart(2, "0")}
                  </strong>
                  <small>
                    {state.mode === "fixture"
                      ? "Simulated outcomes only"
                      : "Verified provider outcomes"}
                  </small>
                </div>
              </div>
              <div className="agent-grid">
                <section className="panel chat-panel">
                  <div className="panel-heading">
                    <div className="agent-avatar">
                      c<span>✦</span>
                    </div>
                    <div>
                      <h2>Your financial agent</h2>
                      <span className="subtle">
                        {state.aiEnabled
                          ? "Existing AI model connected"
                          : "Manual demo · no AI model connected"}
                      </span>
                    </div>
                    <span className="online-label">
                      {state.aiEnabled ? "AI" : "DEMO"}
                    </span>
                  </div>
                  <div className="conversation" aria-live="polite">
                    {state.messages.length === 0 ? (
                      <div className="welcome">
                        <div className="welcome-symbol">✦</div>
                        <h2>What can we get done?</h2>
                        <p>
                          Prepare payments, check an unfinished task,
                          <br />
                          or make sense of your spending.
                        </p>
                        <div className="suggestions">
                          {[
                            "Prepare ₦500 for Ada and ₦700 for Chidi",
                            "What payments are still pending?",
                            "Why did I spend so much on food?",
                          ].map((s, i) => (
                            <button
                              disabled={!!busy}
                              onClick={() => void send(s)}
                              key={s}
                            >
                              <span>
                                {i === 0 ? (
                                  <Send size={15} />
                                ) : i === 1 ? (
                                  <Clock3 size={15} />
                                ) : (
                                  <Wallet size={15} />
                                )}
                              </span>
                              {s}
                              <ArrowUpRight size={14} />
                            </button>
                          ))}
                        </div>
                        <p className="micro">
                          {state.aiEnabled
                            ? "Payment requests become drafts for your review."
                            : "Demo recognizes these commands. Enable OpenAI or Gemini for full conversation and screenshots."}
                        </p>
                      </div>
                    ) : (
                      <>
                        {state.messages.map((m) => (
                          <div className={`message ${m.role}`} key={m.id}>
                            <small>
                              {m.role === "user"
                                ? "You"
                                : state.aiEnabled
                                  ? "Continuity"
                                  : "Demo assistant"}
                            </small>
                            <p>{m.content}</p>
                            <time>{date(m.at)}</time>
                          </div>
                        ))}
                        <div ref={chatEnd} />
                      </>
                    )}
                  </div>
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
                      placeholder="Tell me what you need to do…"
                      aria-label="Message the financial agent"
                      rows={2}
                      maxLength={4000}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send(message);
                        }
                      }}
                    />
                    <div>
                      <label
                        className={`upload-button ${!state.aiEnabled ? "disabled" : ""}`}
                        title="Extract payment drafts from an image"
                      >
                        <ImagePlus size={17} />
                        <span>Upload screenshot</span>
                        <input
                          type="file"
                          hidden
                          accept="image/png,image/jpeg,image/webp"
                          disabled={!!busy || !state.aiEnabled}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        className="send-button"
                        disabled={!!busy || !message.trim()}
                        aria-label="Send message"
                      >
                        {busy === "chat" || busy === "image" ? (
                          <Loader2 className="spin" size={18} />
                        ) : (
                          <ArrowRight size={19} />
                        )}
                      </button>
                    </div>
                  </form>
                  <div className="chat-footnote">
                    <ShieldCheck size={12} />
                    Your agent cannot authorize or execute payments.
                  </div>
                </section>
                <aside className="right-rail">
                  <section className="panel tasks-panel">
                    <div className="section-heading">
                      <h2>Pick up where you left off</h2>
                      <span className="count">{pending.length}</span>
                    </div>
                    {pending.length === 0 ? (
                      <div className="empty-small">
                        <div className="empty-icon">
                          <Check size={19} />
                        </div>
                        <strong>A clear workspace</strong>
                        <p>
                          Unfinished payments will appear here, even after you
                          come back.
                        </p>
                      </div>
                    ) : (
                      pending.slice(0, 4).map((b) => (
                        <button
                          className="task-preview"
                          key={b.id}
                          onClick={() => setTab("Payment jobs")}
                        >
                          <span className="task-icon">
                            <Send size={16} />
                          </span>
                          <span>
                            <strong>
                              {b.payments.length} recipient
                              {b.payments.length !== 1 ? "s" : ""} ·{" "}
                              {money(
                                b.payments.reduce(
                                  (n, p) => n + p.amountKobo,
                                  0,
                                ),
                              )}
                            </strong>
                            <small>{label(b.status)}</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    )}
                    <button
                      className="rail-link"
                      onClick={() => setTab("Payment jobs")}
                    >
                      View all payment jobs <ArrowRight size={14} />
                    </button>
                  </section>
                  <section className="how-card">
                    <p className="eyebrow">FROM REQUEST TO RESULT</p>
                    <h2>
                      A workflow that
                      <br />
                      doesn’t lose the thread.
                    </h2>
                    {[
                      "Prepare your instruction",
                      "Verify every beneficiary",
                      "Review and authorize",
                      "Track the actual outcome",
                    ].map((s, i) => (
                      <div key={s} className="how-step">
                        <span>{i + 1}</span>
                        {s}
                      </div>
                    ))}
                  </section>
                  <div className="build-note">
                    <span className="dot" /> Built for Hackaholics 7.0
                    <br />
                    <small>A prototype for financial task continuity.</small>
                  </div>
                </aside>
              </div>
            </>
          )}
          {tab === "Payment jobs" && (
            <div className="job-list">
              {state.batches.length === 0 ? (
                <div className="panel empty-state">
                  <Send size={28} />
                  <h2>Your next task starts here.</h2>
                  <p>Prepare one payment or a batch of up to ten recipients.</p>
                  <button className="primary" onClick={() => setShowForm(true)}>
                    <Plus size={16} />
                    Prepare a payment
                  </button>
                </div>
              ) : (
                state.batches.map((b) => (
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
                ))
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
                {!allPayments.length && (
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
          <footer className="workspace-footer">
            <span>continuity.</span>
            <span>Prepared with intelligence. Authorized by you.</span>
            <span>Hackaholics 7.0</span>
          </footer>
        </main>
      </div>
      {showForm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prepare-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {editing ? "EDIT PAYMENT JOB" : "NEW PAYMENT JOB"}
                </p>
                <h2 id="prepare-title">Prepare payments</h2>
              </div>
              <button
                aria-label="Close form"
                onClick={() => setShowForm(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted">
              Save a draft, then verify beneficiaries before approval. Editing
              invalidates verification and approval.
            </p>
            {state.mode === "fixture" && (
              <div className="fixture-picker">
                <small>FICTIONAL BENEFICIARIES</small>
                {state.fixtureBeneficiaries.map((p) => (
                  <button
                    key={p.accountNumber}
                    className="secondary"
                    onClick={() =>
                      setRows([
                        ...rows.filter(
                          (r) => r.name || r.accountNumber || r.amountNaira,
                        ),
                        {
                          ...p,
                          amountNaira: p.name.startsWith("Ada")
                            ? "500"
                            : p.name.startsWith("Chidi")
                              ? "700"
                              : "100",
                          reason: "Demo payment",
                        },
                      ])
                    }
                  >
                    {p.name} <Plus size={12} />
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run("save", save);
              }}
            >
              {rows.map((r, i) => (
                <div className="recipient-form" key={i}>
                  <div className="section-heading">
                    <strong>Recipient {i + 1}</strong>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove recipient ${i + 1}`}
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  {r.warnings?.length ? (
                    <div className="field-warning">{r.warnings.join(" ")}</div>
                  ) : null}
                  <div className="form-grid">
                    {[
                      {
                        key: "name",
                        title: "Recipient label",
                        placeholder: "Ada",
                      },
                      {
                        key: "accountNumber",
                        title: "Account number",
                        placeholder: "10 digits",
                      },
                      {
                        key: "amountNaira",
                        title: "Amount (NGN)",
                        placeholder: "500.00",
                      },
                      {
                        key: "reason",
                        title: "Description",
                        placeholder: "Payment",
                      },
                    ].map((f) => (
                      <label key={f.key}>
                        {f.title}
                        <input
                          required
                          maxLength={
                            f.key === "accountNumber"
                              ? 10
                              : f.key === "reason"
                                ? 140
                                : 100
                          }
                          inputMode={
                            ["accountNumber", "amountNaira"].includes(f.key)
                              ? "decimal"
                              : undefined
                          }
                          value={r[f.key as keyof Row] as string}
                          placeholder={f.placeholder}
                          onChange={(e) =>
                            setRows(
                              rows.map((row, j) =>
                                j === i
                                  ? { ...row, [f.key]: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Bank
                      <select
                        required
                        value={r.bankCode}
                        onChange={(e) =>
                          setRows(
                            rows.map((row, j) =>
                              j === i
                                ? { ...row, bankCode: e.target.value }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="">Select a bank</option>
                        {banks.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              <div className="form-footer">
                <button
                  type="button"
                  className="secondary"
                  disabled={rows.length >= 10}
                  onClick={() => setRows([...rows, blank()])}
                >
                  <Plus size={15} />
                  Add recipient
                </button>
                <span className="subtle">
                  Limit {money(state.maxPaymentKobo)} / payment ·{" "}
                  {money(state.maxBatchKobo)} / batch
                </span>
                <button className="primary" disabled={!!busy}>
                  {busy === "save" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  Save draft
                </button>
              </div>
            </form>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
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
