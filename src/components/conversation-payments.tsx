"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/domain";
import {
  BatchCard,
  PaymentEditor,
  paymentApi,
  money,
  type PaymentSnapshot,
  type Row,
  type ViewBatch,
} from "./payment-ui";

export function useConversationPayments(
  authenticated: boolean | null,
  unauthorized: () => void,
) {
  const [snapshot, setSnapshot] = useState<PaymentSnapshot | null>(null);
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [bankError, setBankError] = useState("");
  const [bankLoading, setBankLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false);
  const version = useRef(0);
  const reset = useCallback(() => {
    ++version.current;
    active.current = false;
    setSnapshot(null);
    setBanks([]);
    setError("");
    setBusy(false);
    setUncertain(false);
  }, []);
  const refresh = useCallback(async () => {
    const token = version.current;
    const response = await fetch("/api/state", { cache: "no-store" });
    if (token !== version.current) return;
    if (response.status === 401) {
      reset();
      unauthorized();
      return;
    }
    if (!response.ok)
      throw new Error(
        "Saved payments couldn’t load. Check again before taking another payment action.",
      );
    const data: PaymentSnapshot = await response.json();
    if (token === version.current) {
      setSnapshot(data);
      setUncertain(false);
    }
    return data;
  }, [reset, unauthorized]);
  const loadBanks = useCallback(async () => {
    const token = version.current;
    setBankLoading(true);
    setBankError("");
    try {
      const data = await paymentApi<{ name: string; code: string }[]>("banks");
      if (!data.length) throw new Error("No institutions returned.");
      if (token === version.current) setBanks(data);
    } catch {
      if (token === version.current)
        setBankError("Institutions unavailable. Retry loading them.");
    } finally {
      if (token === version.current) setBankLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!authenticated) {
      reset();
      return;
    }
    void refresh().catch((e) => setError(e.message));
    void loadBanks();
    // Refresh display state only. Reconciliation and submission remain explicit.
    const timer = setInterval(() => {
      if (!active.current) void refresh().catch(() => {});
    }, 20000);
    const generation = version;
    return () => {
      clearInterval(timer);
      ++generation.current;
    };
  }, [authenticated, refresh, loadBanks, reset]);
  const run = async (_key: string, action: () => Promise<unknown>) => {
    if (active.current || uncertain) return;
    active.current = true;
    setBusy(true);
    setError("");
    const token = version.current;
    try {
      await action();
    } catch (e) {
      if (token === version.current)
        setError(
          `${e instanceof Error ? e.message : "Payment response unconfirmed."} Check saved payment status before repeating an action.`,
        );
    } finally {
      if (token === version.current) {
        setUncertain(true);
        try {
          await refresh();
        } catch (e) {
          if (token === version.current)
            setError(
              e instanceof Error
                ? e.message
                : "Check saved payments before continuing.",
            );
        }
        if (token === version.current) {
          active.current = false;
          setBusy(false);
        }
      }
    }
  };
  return {
    snapshot,
    banks,
    bankError,
    bankLoading,
    loadBanks,
    busy: busy || uncertain,
    error,
    refresh,
    reset,
    run,
  };
}
export type PaymentController = ReturnType<typeof useConversationPayments>;

export function PaymentNotice({
  controller: c,
}: {
  controller: PaymentController;
}) {
  return (
    <>
      {c.error && (
        <div className="agus-error" role="alert">
          <p>{c.error}</p>
          <button onClick={() => void c.refresh().catch(() => {})}>
            Check saved payments
          </button>
        </div>
      )}
    </>
  );
}

export function NativePayment({
  controller: c,
  message,
  batch: directBatch,
}: {
  controller: PaymentController;
  message?: Message;
  batch?: ViewBatch;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { snapshot: s } = c;
  if (!s) return null;
  const batch = directBatch ?? s.batches.find((b) => b.id === message?.batchId);
  const rows: Row[] = batch
    ? batch.payments.map((p) => ({
        name: p.name,
        bankCode: p.bankCode,
        accountNumber: p.accountNumber,
        amountNaira: (p.amountKobo / 100).toFixed(2),
        reason: p.reason,
      }))
    : (message?.proposals ?? []).map((p) => ({
        ...p,
        bankCode: p.bankCode ?? "",
        accountNumber: p.accountNumber ?? "",
        amountNaira: p.amountNaira ?? "",
      }));
  if (!batch && !rows.length) return null;
  const common = {
    banks: c.banks,
    bankError: c.bankError,
    bankLoading: c.bankLoading,
    onRetryBanks: () => void c.loadBanks(),
    fixtures: s.fixtureBeneficiaries,
    busy: c.busy,
    maxPaymentKobo: s.maxPaymentKobo,
    maxBatchKobo: s.maxBatchKobo,
  };
  return (
    <details
      className="agus-payment"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>
        <span>
          {s.mode === "fixture" ? "Simulated payment" : "Payment"} ·{" "}
          {batch
            ? money(batch.payments.reduce((n, p) => n + p.amountKobo, 0))
            : "Editable draft"}
        </span>
        <small>
          {batch
            ? batch.status.replaceAll("_", " ")
            : `${rows.length} recipient${rows.length === 1 ? "" : "s"} · Unverified`}
        </small>
      </summary>
      <div className="agus-payment-body">
        {batch && !editing ? (
          <BatchCard
            key={batch.reviewDigest}
            batch={batch}
            banks={c.banks}
            busy={c.busy}
            editing={false}
            run={c.run}
            edit={() => setEditing(true)}
            mode={s.mode}
            stopped={s.emergencyDisabled}
          />
        ) : (
          <PaymentEditor
            key={batch ? `${batch.id}:${batch.version}` : message?.id}
            {...common}
            initialRows={rows}
            editing={!!batch}
            sourceMessageId={batch ? undefined : message?.id}
            sourceRequest={message?.sourceRequest}
            onCancel={batch ? () => setEditing(false) : undefined}
            onSave={(payments) =>
              c.run("save", async () => {
                await paymentApi(
                  batch ? `batches/${batch.id}/edit` : "batches",
                  {
                    payments,
                    ...(batch
                      ? { expectedVersion: batch.version }
                      : { sourceMessageId: message?.id }),
                  },
                );
                setEditing(false);
              })
            }
          />
        )}
      </div>
    </details>
  );
}
