import { z } from "zod";
import { mutate, readState } from "./db";
import { config, executionGate } from "./config";
import {
  AppError,
  audit,
  batchStatus,
  digest,
  id,
  instructionSchema,
  now,
  principal,
  providerStatus,
  reference,
  reserve,
  terminal,
  transition,
  type Batch,
  type Payment,
  type State,
  type WebhookWork,
} from "./domain";
import {
  provider,
  ProviderError,
  verifySignature,
  confirmedFeeKobo,
  recipientIdentity,
  type PaymentProvider,
  type ProviderResult,
  type TransferData,
} from "./paystack";
import { hash } from "./auth";
export function findBatch(s: State, batchId: string, actor: string) {
  const b = s.batches.find((x) => x.id === batchId && x.owner === actor);
  if (!b) throw new AppError("Payment batch not found", 404);
  return b;
}
export function checkLimits(b: Batch) {
  const c = config();
  if (
    b.payments.some((p) => p.amountKobo > c.maxPayment) ||
    principal(b) > c.maxBatch
  )
    throw new AppError("Configured payment or batch limit exceeded");
}
export async function preparePaymentBatch(
  actor: string,
  input: unknown,
  sourceMessageId?: string,
) {
  const values = z.array(instructionSchema).min(1).max(10).parse(input);
  const c = config();
  const b: Batch = {
    id: id(),
    owner: actor,
    mode: c.mode,
    createdAt: now(),
    updatedAt: now(),
    version: 1,
    feeReserveKobo: c.feeReserve,
    status: "awaiting_beneficiary_verification",
    payments: values.map((p) => ({
      ...p,
      id: id(),
      reference: reference(),
      status: "awaiting_beneficiary_verification",
      responses: [],
    })),
  };
  checkLimits(b);
  return mutate((s) => {
    // Link the conversation and draft in the same persisted write. CAS retries
    // must not create two drafts for a double-click or concurrent request.
    if (sourceMessageId) {
      const message = s.messages.find(
        (m) =>
          m.id === sourceMessageId &&
          m.owner === actor &&
          m.role === "assistant" &&
          m.proposals?.length,
      );
      if (!message) throw new AppError("Proposal not found", 404);
      if (message.batchId || message.supersededBy)
        throw new AppError(
          "Proposal already saved or continued. Review its latest payment card.",
          409,
        );
      message.batchId = b.id;
    }
    s.batches.unshift(b);
    audit(
      s,
      actor,
      "batch.prepared",
      { paymentCount: b.payments.length, totalKobo: principal(b) },
      b.id,
    );
    return b;
  });
}
export async function editBatch(
  actor: string,
  batchId: string,
  input: unknown,
) {
  const values = z.array(instructionSchema).min(1).max(10).parse(input);
  return mutate((s) => {
    const b = findBatch(s, batchId, actor);
    if (
      b.payments.some(
        (p) =>
          ![
            "draft",
            "awaiting_beneficiary_verification",
            "awaiting_user_approval",
            "approved",
          ].includes(p.status),
      )
    )
      throw new AppError("Submitted instructions are immutable", 409);
    b.payments = values.map((p) => ({
      ...p,
      id: id(),
      reference: reference(),
      status: "awaiting_beneficiary_verification",
      responses: [],
    }));
    b.approval = undefined;
    b.status = "awaiting_beneficiary_verification";
    b.version++;
    b.updatedAt = now();
    checkLimits(b);
    audit(
      s,
      actor,
      "batch.edited_approval_invalidated",
      { version: b.version },
      b.id,
    );
    return b;
  });
}
export async function verifyBeneficiaries(
  actor: string,
  batchId: string,
  api: PaymentProvider = provider(),
) {
  const b = findBatch(await readState(), batchId, actor);
  if (b.mode !== api.mode)
    throw new AppError("Payment environment mismatch", 409);
  if (
    b.approval ||
    b.payments.some(
      (p) =>
        ![
          "awaiting_beneficiary_verification",
          "awaiting_user_approval",
          "draft",
        ].includes(p.status),
    )
  )
    throw new AppError(
      "Edit the batch before changing approved instructions",
      409,
    );
  const banks = await api.banks();
  for (const p of b.payments) {
    try {
      if (!banks.some((x) => x.code === p.bankCode))
        throw new AppError("Bank is not supported");
      if (
        b.mode === "live" &&
        !config().allowlist.includes(`${p.bankCode}:${p.accountNumber}`)
      )
        throw new AppError("Beneficiary is outside the live allowlist", 403);
      const resolved = await api.resolve(p.accountNumber, p.bankCode);
      if (resolved.data.account_number !== p.accountNumber)
        throw new ProviderError(
          "Resolved account number mismatch",
          resolved.raw,
        );
      await mutate((s) => {
        const current = findBatch(s, batchId, actor);
        if (current.version !== b.version || current.approval)
          throw new AppError("Batch changed during verification", 409);
        const payment = current.payments.find((x) => x.id === p.id)!;
        payment.responses.push({
          at: now(),
          operation: "resolve",
          data: resolved.raw,
        });
      });
      const r = await api.recipient(p, resolved.data.account_name);
      await mutate((s) => {
        const current = findBatch(s, batchId, actor);
        if (current.version !== b.version || current.approval)
          throw new AppError("Batch changed during verification", 409);
        const payment = current.payments.find((x) => x.id === p.id)!;
        payment.verifiedName = resolved.data.account_name;
        payment.recipientCode = r.data.recipient_code;
        payment.recipientId = r.data.id;
        payment.verifiedAt = now();
        payment.lastError = undefined;
        payment.status = "awaiting_user_approval";
        payment.responses.push({
          at: now(),
          operation: "recipient",
          data: r.raw,
        });
        current.status = batchStatus(current);
        current.updatedAt = now();
        audit(
          s,
          actor,
          "beneficiary.verified",
          { paymentId: p.id, name: payment.verifiedName, source: api.mode },
          batchId,
        );
      });
    } catch (e) {
      await mutate((s) => {
        const current = findBatch(s, batchId, actor);
        if (current.version !== b.version || current.approval) return;
        const payment = current.payments.find((x) => x.id === p.id)!;
        payment.verifiedName = undefined;
        payment.recipientCode = undefined;
        payment.recipientId = undefined;
        payment.verifiedAt = undefined;
        payment.status = "awaiting_beneficiary_verification";
        current.status = batchStatus(current);
        payment.lastError =
          e instanceof Error ? e.message : "Verification failed";
        payment.responses.push({
          at: now(),
          operation: "beneficiary_verification_error",
          data:
            e instanceof ProviderError ? e.raw : { error: payment.lastError },
        });
        audit(
          s,
          actor,
          "beneficiary.verification_failed",
          { paymentId: p.id, error: payment.lastError },
          batchId,
        );
      });
      throw e;
    }
  }
  return findBatch(await readState(), batchId, actor);
}
export async function approveBatch(
  actor: string,
  batchId: string,
  reviewDigest: string,
) {
  return mutate((s) => {
    const b = findBatch(s, batchId, actor);
    checkLimits(b);
    if (
      b.status !== "awaiting_user_approval" ||
      b.approval ||
      b.payments.some((p) => !p.verifiedName || !p.recipientCode)
    )
      throw new AppError("Verify every beneficiary before approval", 409);
    if (digest(b) !== reviewDigest)
      throw new AppError("Review changed; refresh before approving", 409);
    b.approval = {
      actor,
      at: now(),
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      digest: reviewDigest,
      nonce: id(),
    };
    b.payments.forEach((p) => (p.status = "approved"));
    b.status = "approved";
    audit(
      s,
      actor,
      "batch.approved",
      {
        ...b.approval,
        snapshot: b.payments.map((p) => ({
          bankCode: p.bankCode,
          accountNumber: p.accountNumber,
          verifiedName: p.verifiedName,
          amountKobo: p.amountKobo,
          reference: p.reference,
          reason: p.reason,
        })),
        feeReserveKobo: b.feeReserveKobo,
        totalKobo: reserve(b),
      },
      batchId,
    );
    return b;
  });
}
function validateTransfer(
  p: Payment,
  b: Batch,
  data: TransferData,
  verified: boolean,
) {
  if (
    data.reference !== p.reference ||
    data.amount !== p.amountKobo ||
    data.currency !== "NGN"
  )
    throw new AppError("Provider transfer identity mismatch", 502);
  if (b.mode !== "fixture" && data.domain !== b.mode)
    throw new AppError("Provider transfer environment mismatch", 502);
  if (
    b.mode === "live" &&
    String(data.integration) !== process.env.PAYSTACK_INTEGRATION_ID
  )
    throw new AppError("Provider integration mismatch", 502);
  const identity = recipientIdentity(data.recipient);
  if (
    (identity.code !== undefined && identity.code !== p.recipientCode) ||
    (identity.recipientId !== undefined &&
      p.recipientId !== undefined &&
      identity.recipientId !== p.recipientId) ||
    (identity.accountNumber !== undefined &&
      identity.accountNumber !== p.accountNumber) ||
    (identity.bankCode !== undefined && identity.bankCode !== p.bankCode) ||
    (data.transfer_code !== undefined &&
      p.transferCode !== undefined &&
      data.transfer_code !== p.transferCode)
  )
    throw new AppError("Provider recipient mismatch", 502);
  const matched =
    (identity.code !== undefined && identity.code === p.recipientCode) ||
    (identity.recipientId !== undefined &&
      identity.recipientId === p.recipientId) ||
    (identity.accountNumber === p.accountNumber &&
      identity.bankCode === p.bankCode);
  if (verified && !matched)
    throw new AppError(
      "Provider recipient identity is insufficient to verify the outcome",
      502,
    );
  confirmedFeeKobo(data);
}
async function record(
  actor: string,
  batchId: string,
  paymentId: string,
  operation: string,
  result: ProviderResult<TransferData>,
  verified: boolean,
  generation: number,
  eventId?: string,
) {
  return mutate((s) => {
    const b = findBatch(s, batchId, actor);
    const p = b.payments.find((x) => x.id === paymentId)!;
    p.responses.push({ at: now(), operation, data: result.raw });
    if ((p.operationGeneration ?? 0) !== generation) {
      audit(
        s,
        actor,
        "transfer.stale_response_ignored",
        { paymentId, operation, generation },
        batchId,
      );
      return b;
    }
    try {
      validateTransfer(p, b, result.data, verified);
    } catch (e) {
      throw new ProviderError(
        e instanceof Error ? e.message : "Provider identity mismatch",
        result.raw,
      );
    }
    p.transferCode = result.data.transfer_code ?? p.transferCode;
    let nextStatus = verified
      ? providerStatus(result.data.status)
      : result.data.status === "otp"
        ? "awaiting_otp"
        : "processing";
    // A claimed OTP operation can never be reopened, even by a fresh otp response.
    if (p.otpFinalization && nextStatus === "awaiting_otp")
      nextStatus = "unknown";
    p.status = transition(p.status, nextStatus);
    if (operation === "finalize" && p.otpFinalization)
      p.otpFinalization.outcome =
        nextStatus === "unknown" ? "uncertain" : "recorded";
    const fee = confirmedFeeKobo(result.data);
    if (verified && fee !== undefined) p.providerFeeKobo = fee;
    p.lastError = undefined;
    b.status = batchStatus(b);
    b.updatedAt = now();
    audit(
      s,
      actor,
      `transfer.${operation}`,
      {
        paymentId,
        status: p.status,
        providerStatus: result.data.status,
        reference: p.reference,
      },
      batchId,
    );
    const work = s.webhookWork.find((w) => w.eventId === eventId);
    if (work && !work.completedAt) {
      const expected = providerStatus(work.event.replace("transfer.", ""));
      if (
        nextStatus === expected ||
        p.status === "reversed" ||
        (expected === "failed" && nextStatus === "successful")
      ) {
        work.completedAt = now();
        work.lastError = undefined;
        audit(
          s,
          actor,
          "webhook.reconciled",
          { eventId, paymentId, status: p.status },
          batchId,
        );
      } else {
        work.lastError = `Awaiting provider confirmation of ${work.event}; observed ${nextStatus}`;
        audit(
          s,
          actor,
          "webhook.reconciliation_pending",
          { eventId, status: nextStatus },
          batchId,
        );
      }
    }
    return b;
  });
}
async function uncertain(
  actor: string,
  batchId: string,
  paymentId: string,
  e: unknown,
  operation: string,
  generation: number,
  eventId?: string,
) {
  return mutate((s) => {
    const b = findBatch(s, batchId, actor);
    const p = b.payments.find((x) => x.id === paymentId)!;
    if ((p.operationGeneration ?? 0) !== generation) {
      p.responses.push({
        at: now(),
        operation: `${operation}_stale_error`,
        data: e instanceof ProviderError ? e.raw : { error: String(e) },
      });
      audit(
        s,
        actor,
        "transfer.stale_error_ignored",
        { paymentId, operation, generation },
        batchId,
      );
      return b;
    }
    p.status = transition(p.status, "unknown");
    p.lastError = e instanceof Error ? e.message : "Unknown provider outcome";
    if (operation === "finalize" && p.otpFinalization)
      p.otpFinalization.outcome = "uncertain";
    const work = s.webhookWork.find((w) => w.eventId === eventId);
    if (work && !work.completedAt) work.lastError = p.lastError;
    p.responses.push({
      at: now(),
      operation,
      data: e instanceof ProviderError ? e.raw : { error: p.lastError },
    });
    b.status = batchStatus(b);
    b.updatedAt = now();
    audit(
      s,
      actor,
      "transfer.uncertain",
      { paymentId, operation, error: p.lastError },
      batchId,
    );
    return b;
  });
}
export async function executeBatch(
  actor: string,
  batchId: string,
  nonce: string,
  api: PaymentProvider = provider(),
) {
  const before = findBatch(await readState(), batchId, actor);
  executionGate(before.mode, (await readState()).emergencyDisabled);
  if (api.mode !== before.mode)
    throw new AppError("Provider environment mismatch", 409);
  const balance = await api.balance();
  const claimed = await mutate((s) => {
    const b = findBatch(s, batchId, actor);
    executionGate(b.mode, s.emergencyDisabled);
    checkLimits(b);
    if (
      b.mode === "live" &&
      b.payments.some(
        (p) => !config().allowlist.includes(`${p.bankCode}:${p.accountNumber}`),
      )
    )
      throw new AppError("Beneficiary allowlist changed", 403);
    const a = b.approval;
    if (
      !a ||
      a.actor !== actor ||
      a.consumedAt ||
      a.nonce !== nonce ||
      a.digest !== digest(b) ||
      a.expiresAt < now() ||
      b.payments.some((p) => p.status !== "approved")
    )
      throw new AppError(
        "Approval missing, expired, changed, or already consumed",
        409,
      );
    const outstanding = s.batches
      .filter((x) => x.mode === b.mode && x.id !== b.id)
      .flatMap((x) => x.payments.map((p) => ({ p, fee: x.feeReserveKobo })))
      .filter(({ p }) =>
        ["submitted", "processing", "unknown", "awaiting_otp"].includes(
          p.status,
        ),
      )
      .reduce((n, { p, fee }) => n + p.amountKobo + fee, 0);
    if (balance.data < reserve(b) + outstanding)
      throw new AppError(
        "Insufficient available transfer balance including fee reserves",
        409,
      );
    a.consumedAt = now();
    b.payments.forEach((p) => {
      p.status = "submitted";
      p.operationGeneration = (p.operationGeneration ?? 0) + 1;
    });
    b.status = "submitted";
    audit(
      s,
      actor,
      "batch.execution_claimed",
      { balance: balance.raw, nonce: a.nonce },
      batchId,
    );
    return structuredClone(b);
  });
  for (const p of claimed.payments) {
    try {
      executionGate(claimed.mode, (await readState()).emergencyDisabled);
      const r = await api.submit(p);
      await record(
        actor,
        batchId,
        p.id,
        "submit",
        r,
        false,
        p.operationGeneration ?? 0,
      );
    } catch (e) {
      await uncertain(
        actor,
        batchId,
        p.id,
        e,
        "submit",
        p.operationGeneration ?? 0,
      );
    }
  }
  return findBatch(await readState(), batchId, actor);
}
export async function reconcileBatch(
  actor: string,
  batchId: string,
  api: PaymentProvider = provider(),
) {
  const b = findBatch(await readState(), batchId, actor);
  if (api.mode !== b.mode)
    throw new AppError("Provider environment mismatch", 409);
  for (const p of b.payments.filter((x) =>
    [
      "submitted",
      "processing",
      "unknown",
      "awaiting_otp",
      "successful",
    ].includes(x.status),
  )) {
    try {
      await record(
        actor,
        batchId,
        p.id,
        "verify",
        await api.verify(p),
        true,
        p.operationGeneration ?? 0,
      );
    } catch (e) {
      await uncertain(
        actor,
        batchId,
        p.id,
        e,
        "verify",
        p.operationGeneration ?? 0,
      );
    }
  }
  return findBatch(await readState(), batchId, actor);
}
export async function finalizeOTP(
  actor: string,
  batchId: string,
  paymentId: string,
  otp: string,
  api: PaymentProvider = provider(),
) {
  z.string()
    .regex(/^\d{4,10}$/)
    .parse(otp);
  const claimed = await mutate((s) => {
    const b = findBatch(s, batchId, actor);
    executionGate(b.mode, s.emergencyDisabled);
    checkLimits(b);
    if (
      b.mode === "live" &&
      b.payments.some(
        (p) => !config().allowlist.includes(`${p.bankCode}:${p.accountNumber}`),
      )
    )
      throw new AppError("Beneficiary allowlist changed", 403);
    if (
      b.mode !== api.mode ||
      !b.approval?.consumedAt ||
      b.approval.digest !== digest(b)
    )
      throw new AppError("Invalid approved transfer", 409);
    const p = b.payments.find((x) => x.id === paymentId);
    if (
      !p ||
      p.status !== "awaiting_otp" ||
      !p.transferCode ||
      p.otpFinalization
    )
      throw new AppError("Transfer is not awaiting OTP", 409);
    p.status = "submitted";
    p.operationGeneration = (p.operationGeneration ?? 0) + 1;
    p.otpFinalization = {
      claimId: id(),
      claimedAt: now(),
      generation: p.operationGeneration,
      outcome: "claimed",
    };
    b.status = batchStatus(b);
    b.updatedAt = now();
    audit(
      s,
      actor,
      "transfer.otp_submitted",
      { paymentId, ...p.otpFinalization },
      batchId,
    );
    return structuredClone(p);
  });
  try {
    return await record(
      actor,
      batchId,
      paymentId,
      "finalize",
      await api.finalize(claimed, otp),
      false,
      claimed.operationGeneration ?? 0,
    );
  } catch (e) {
    return uncertain(
      actor,
      batchId,
      paymentId,
      e,
      "finalize",
      claimed.operationGeneration ?? 0,
    );
  }
}
export async function webhook(
  raw: string,
  signature: string | null,
  api: PaymentProvider = provider(),
) {
  if (api.mode === "fixture")
    throw new AppError("Webhooks are disabled for fixtures", 403);
  if (!verifySignature(raw, signature, config().key))
    throw new AppError("Invalid webhook signature", 401);
  const payload = z
    .object({
      event: z.string(),
      data: z.object({ reference: z.string() }).passthrough(),
    })
    .passthrough()
    .parse(JSON.parse(raw));
  if (
    !["transfer.success", "transfer.failed", "transfer.reversed"].includes(
      payload.event,
    )
  )
    return { ignored: true };
  const eventId = hash(raw);
  // Receipt deduplication and durable work creation commit together, before I/O.
  const receipt = await mutate((s) => {
    const duplicate = s.webhookIds.includes(eventId);
    if (!duplicate) {
      s.webhookIds.push(eventId);
      audit(s, "paystack", "webhook.received", { eventId, payload });
    }
    let work = s.webhookWork.find((w) => w.eventId === eventId);
    // Also repairs old receipt-only snapshots on redelivery.
    if (!work) {
      const b = s.batches.find(
        (b) =>
          b.mode === api.mode &&
          b.approval?.consumedAt &&
          b.payments.some((p) => p.reference === payload.data.reference),
      );
      const p = b?.payments.find((p) => p.reference === payload.data.reference);
      if (
        b &&
        p &&
        ![
          "draft",
          "approved",
          "awaiting_beneficiary_verification",
          "awaiting_user_approval",
        ].includes(p.status)
      ) {
        work = {
          eventId,
          batchId: b.id,
          paymentId: p.id,
          event: payload.event as WebhookWork["event"],
          receivedAt: now(),
          attempts: 0,
        };
        s.webhookWork.push(work);
        audit(
          s,
          "paystack",
          "webhook.reconciliation_queued",
          { eventId, paymentId: p.id },
          b.id,
        );
      }
    }
    return { duplicate, queued: !!work };
  });
  if (receipt.queued) await reconcileWebhookWork(eventId, api);
  return receipt.duplicate
    ? { duplicate: true }
    : receipt.queued
      ? { received: true }
      : { ignored: true };
}

export async function reconcileWebhookWork(
  eventId: string,
  api: PaymentProvider = provider(),
) {
  const attempt = await mutate((s) => {
    const work = s.webhookWork.find(
      (w) => w.eventId === eventId && !w.completedAt,
    );
    if (!work) return;
    const b = s.batches.find(
      (b) =>
        b.id === work.batchId && b.mode === api.mode && b.approval?.consumedAt,
    );
    const p = b?.payments.find((p) => p.id === work.paymentId);
    if (!b || !p) return;
    work.attempts++;
    work.lastAttemptAt = now();
    audit(
      s,
      "paystack",
      "webhook.reconciliation_attempt",
      { eventId, attempt: work.attempts },
      b.id,
    );
    return structuredClone({ b, p });
  });
  if (!attempt) return;
  const { b, p } = attempt;
  try {
    await record(
      b.owner,
      b.id,
      p.id,
      "webhook_verify",
      await api.verify(p),
      true,
      p.operationGeneration ?? 0,
      eventId,
    );
  } catch (e) {
    await uncertain(
      b.owner,
      b.id,
      p.id,
      e,
      "webhook_verify",
      p.operationGeneration ?? 0,
      eventId,
    );
  }
}

// Scheduled recovery makes GET verification calls only, including work on terminal payments.
export async function reconcileOutstanding(api: PaymentProvider = provider()) {
  const state = await readState();
  for (const work of state.webhookWork.filter((w) => !w.completedAt))
    await reconcileWebhookWork(work.eventId, api);
  const remaining = await readState();
  for (const b of remaining.batches.filter(
    (b) =>
      b.mode === api.mode &&
      b.approval?.consumedAt &&
      b.payments.some((p) =>
        ["submitted", "processing", "unknown", "awaiting_otp"].includes(
          p.status,
        ),
      ),
  ))
    await reconcileBatch(b.owner, b.id, api);
}
export async function listPendingPayments(actor: string) {
  return (await readState()).batches.filter(
    (b) => b.owner === actor && b.payments.some((p) => !terminal(p.status)),
  );
}

export async function resolveBankAccount(
  accountNumber: string,
  bankCode: string,
  api: PaymentProvider = provider(),
) {
  const input = instructionSchema.parse({
    name: "Lookup",
    accountNumber,
    bankCode,
    amountKobo: 1,
    reason: "",
  });
  return api.resolve(input.accountNumber, input.bankCode);
}
