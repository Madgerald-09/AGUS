"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  KeyRound,
  LockKeyhole,
  Search,
  Check,
  CircleAlert,
  CircleX,
  Undo2,
  Clock3,
  ShieldCheck,
  X,
  RefreshCw,
  Trash2,
  Plus,
  Send,
} from "lucide-react";
import type { Batch, Instruction, Mode, Message } from "@/lib/domain";
export type ViewBatch = Batch & { reviewDigest: string };
export type Row = {
  name: string;
  bankCode: string;
  accountNumber: string;
  amountNaira: string;
  reason: string;
  warnings?: string[];
};
export type PaymentSnapshot = {
  mode: Mode;
  aiEnabled: boolean;
  emergencyDisabled: boolean;
  maxPaymentKobo: number;
  maxBatchKobo: number;
  batches: ViewBatch[];
  messages: Message[];
  fixtureBeneficiaries: {
    name: string;
    bankCode: string;
    accountNumber: string;
  }[];
};
type Snapshot = PaymentSnapshot;
export const money = (n: number) =>
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
const statusLabels: Record<string, string> = {
  draft: "Draft",
  awaiting_beneficiary_verification: "Needs verification",
  awaiting_user_approval: "Needs your approval",
  approved: "Approved · not submitted",
  submitted: "Submitted · unresolved",
  processing: "Processing · unresolved",
  successful: "Successful",
  failed: "Failed",
  reversed: "Reversed",
  unknown: "Unknown · needs follow-up",
  awaiting_otp: "Awaiting provider OTP",
};

const label = (s: string) => statusLabels[s] ?? s.replaceAll("_", " ");
const bankName = (code: string, banks: { name: string; code: string }[]) =>
  banks.find((b) => b.code === code)?.name ?? code;
const terminal = (s: string) =>
  ["successful", "failed", "reversed"].includes(s);
export async function paymentApi<T>(
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
      {label(status)}
    </span>
  );
}
export function PaymentEditor({
  initialRows,
  banks,
  bankError,
  bankLoading,
  onRetryBanks,
  fixtures,
  busy,
  sourceRequest,
  sourceMessageId,
  editing,
  stale = false,
  onReload,
  onSave,
  onCancel,
  maxPaymentKobo,
  maxBatchKobo,
}: {
  initialRows: Row[];
  banks: { name: string; code: string }[];
  bankError: string;
  bankLoading: boolean;
  onRetryBanks: () => void;
  fixtures: Snapshot["fixtureBeneficiaries"];
  busy: boolean;
  sourceRequest?: string;
  sourceMessageId?: string;
  editing?: boolean;
  stale?: boolean;
  onReload?: () => void;
  onSave: (payments: Instruction[]) => Promise<void>;
  onCancel?: () => void;
  maxPaymentKobo: number;
  maxBatchKobo: number;
}) {
  const editorRef = useRef<HTMLElement>(null);
  const standalone = !!onCancel;
  useLayoutEffect(() => {
    if (standalone) editorRef.current?.focus({ preventScroll: true });
  }, [standalone]);
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
        paymentApi(`proposals/${sourceMessageId}`, {
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
      ref={editorRef}
      tabIndex={standalone ? -1 : undefined}
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
        <p className="request-link">Original request: “{sourceRequest}”</p>
      )}
      <p className="muted">
        Your label is separate from the verified account name. Save, then verify
        the destination.{" "}
        {editing && "Editing invalidates verification and approval."}
      </p>
      {stale && (
        <div className="alert" role="alert">
          <p>
            This draft changed in chat or another session. Load its latest
            details before saving.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onReload}
          >
            Load latest draft
          </button>
        </div>
      )}
      {bankError && (
        <div className="alert" role="alert">
          <p>Banks couldn’t be loaded. {bankError}</p>
          <button
            type="button"
            className="secondary"
            disabled={bankLoading || busy}
            onClick={onRetryBanks}
          >
            <RefreshCw size={14} />{" "}
            {bankLoading ? "Loading banks…" : "Retry bank loading"}
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (stale) return;
          setError("");
          try {
            const payments = rows.map((r, i) => {
              if (!banks.some((b) => b.code === r.bankCode))
                throw new Error(
                  `Choose an available financial institution for recipient ${i + 1}.`,
                );
              if (!/^\d+(\.\d{1,2})?$/.test(r.amountNaira))
                throw new Error(
                  "Enter an amount with at most two decimal places.",
                );
              const [a, b = ""] = r.amountNaira.split(".");
              const amountKobo = Number(a) * 100 + Number(b.padEnd(2, "0"));
              if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0)
                throw new Error(
                  `Enter an amount greater than zero for recipient ${i + 1}.`,
                );
              return {
                name: r.name,
                bankCode: r.bankCode,
                accountNumber: r.accountNumber,
                amountKobo,
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
            {rows.length > 1 && (
              <div className="section-heading">
                <span className="muted">{r.name || "Recipient details"}</span>
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
              </div>
            )}
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
                  <option value="">Select sample details</option>
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
                  key: "bankCode",
                  title: "Financial institution",
                  hint: "",
                  length: 6,
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
              ].map(({ key, title, hint, length }) =>
                key === "bankCode" ? (
                  <label key={key}>
                    Financial institution
                    <select
                      required
                      aria-label="Bank"
                      disabled={bankLoading || banks.length === 0}
                      value={r.bankCode}
                      onBlur={() => void persist()}
                      onChange={(e) => update(i, "bankCode", e.target.value)}
                    >
                      <option value="">
                        {bankLoading
                          ? "Loading institutions…"
                          : "Select institution"}
                      </option>
                      {r.bankCode &&
                        !banks.some((b) => b.code === r.bankCode) && (
                          <option value={r.bankCode}>
                            Institution code {r.bankCode} · unavailable
                          </option>
                        )}
                      {banks.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
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
                ),
              )}
            </div>
            {r.warnings?.length ? (
              <details className="field-warning" open={!r.accountNumber}>
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
          <button
            className="primary"
            disabled={busy || stale || bankLoading || banks.length === 0}
          >
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
export function BatchCard({
  batch: b,
  banks,
  busy,
  editing,
  run,
  edit,
  mode,
  stopped,
}: {
  batch: ViewBatch;
  banks: { name: string; code: string }[];
  busy: boolean;
  editing: boolean;
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
    run(`${op}-${b.id}`, () => paymentApi(`batches/${b.id}/${op}`, body));
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
            "Submit separately",
            "Track outcomes",
          ].map((step, i) => {
            const current =
              b.approval?.consumedAt ||
              b.payments.every((p) => terminal(p.status))
                ? 4
                : b.approval
                  ? 3
                  : b.payments.every((p) => p.verifiedName)
                    ? 2
                    : 1;
            return (
              <li
                key={step}
                aria-current={i === current ? "step" : undefined}
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
        {editing
          ? "You’re editing this draft. Save your changes or close the editor before continuing."
          : b.payments.some((p) =>
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
              <small>Recipient label: {p.name}</small>
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
