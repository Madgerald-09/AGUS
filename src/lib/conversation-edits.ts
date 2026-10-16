import { createHash } from "node:crypto";
import { mutate } from "./db";
import {
  AppError,
  id,
  now,
  nairaToKobo,
  type Message,
  type State,
  type Batch,
} from "./domain";
import { editBatch, preparePaymentBatch } from "./payments";
import { provider } from "./paystack";
import { parseDraftEdit, resolveBankName } from "./draft-edits";
import type { Proposed } from "./intelligence";

type Draft = {
  key: string;
  message?: Message;
  batch?: Batch;
  rows: Proposed[];
};
const fingerprint = (rows: Proposed[]) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const batchRows = (batch: Batch): Proposed[] =>
  batch.payments.map((p) => ({
    name: p.name,
    bankCode: p.bankCode,
    accountNumber: p.accountNumber,
    amountNaira: (p.amountKobo / 100).toFixed(2),
    reason: p.reason,
    confidence: "medium",
    warnings: [],
  }));
const editable = (b: Batch) =>
  !b.approval?.consumedAt &&
  b.payments.every((p) =>
    [
      "draft",
      "awaiting_beneficiary_verification",
      "awaiting_user_approval",
      "approved",
    ].includes(p.status),
  );
export async function editConversationDraft(
  actor: string,
  text: string,
  state: State,
  aiEnabled: boolean,
) {
  const edit = parseDraftEdit(text);
  if (!edit) return;
  const messages = state.messages.filter(
    (m) => m.owner === actor && m.role === "assistant",
  );
  const drafts: Draft[] = messages
    .filter((m) => m.proposals?.length && !m.batchId && !m.supersededBy)
    .map((message) => ({ key: message.id, message, rows: message.proposals! }));
  for (const batch of state.batches.filter(
    (b) => b.owner === actor && editable(b),
  )) {
    drafts.push({
      key: batch.id,
      batch,
      message: messages.findLast((m) => m.batchId === batch.id),
      rows: batchRows(batch),
    });
  }
  // Explicit field commands without existing context remain new preparation requests.
  if (
    !drafts.length &&
    /^(?:name|amount|bank|account)\s*(?:number|code)?\s*[:=]/i.test(text.trim())
  )
    return;
  let draft: Draft | undefined;
  let index = edit.recipientIndex;
  const selection = messages.at(-1)?.draftSelection;
  if (edit.recipientName) {
    const matches = drafts.flatMap((d) =>
      d.rows.flatMap((p, i) =>
        p.name.toLowerCase() === edit.recipientName!.toLowerCase()
          ? [{ draft: d, index: i }]
          : [],
      ),
    );
    if (matches.length === 1) ({ draft, index } = matches[0]);
  } else if (selection && edit.recipientIndex === undefined) {
    draft = drafts.find(
      (d) =>
        d.key === selection.draftId &&
        fingerprint(d.rows) === selection.fingerprint,
    );
    if (draft) index = selection.recipientIndex;
  }
  if (!draft && !edit.recipientName && drafts.length === 1) draft = drafts[0];
  if (draft && index === undefined && draft.rows.length === 1) index = 0;
  let reply: string;
  let proposals: Proposed[] = [];
  let batchId: string | undefined;
  let changed = false;
  let selectionRows: Proposed[] | undefined;
  const validTarget =
    draft && index !== undefined && index >= 0 && index < draft.rows.length;
  if (!drafts.length) {
    const immutable = state.batches.some(
      (b) => b.owner === actor && !editable(b),
    );
    reply = immutable
      ? "Submitted payment details can’t be changed. Open its card to check the saved outcome before preparing another transfer."
      : "Which payment would you like to change? Prepare a draft first, or open an existing editable card.";
  } else if (!validTarget) {
    reply = !draft
      ? "Which draft should I change? Say “I meant” followed by its exact recipient label, or open that draft’s Edit details."
      : `Which recipient should I change? ${draft!.rows.map((p, i) => `${i + 1}. ${p.name || "Unlabelled recipient"}`).join("; ")}. You can say “the second recipient”.`;
  } else {
    const row = draft!.rows[index!];
    const who = row.name || `recipient ${index! + 1}`;
    const patch: Partial<Proposed> = {};
    let bankName: string | undefined;
    let clarification: string | undefined;
    if (edit.bankQuery || edit.bankCode) {
      try {
        const banks = await provider().banks();
        const matches = edit.bankCode
          ? banks.filter((b) => b.code === edit.bankCode)
          : resolveBankName(edit.bankQuery!, banks);
        if (matches.length !== 1)
          clarification = matches.length
            ? "That name matches more than one institution. Which exact bank name should I use?"
            : "That institution isn’t in the available bank list. Choose a listed bank in Edit details, or give its exact name. I haven’t changed the draft.";
        else {
          patch.bankCode = matches[0].code;
          bankName = matches[0].name;
        }
      } catch {
        clarification =
          "I couldn’t load the provider’s bank list, so I haven’t changed the draft. Try again, or retry bank loading in Edit details.";
      }
    }
    if (edit.accountNumber) patch.accountNumber = edit.accountNumber;
    if (edit.amountNaira) {
      nairaToKobo(edit.amountNaira);
      patch.amountNaira = edit.amountNaira;
    }
    if (edit.name !== undefined) patch.name = edit.name;
    if (clarification) reply = clarification;
    else if (edit.missing)
      reply =
        edit.missing === "change"
          ? `Okay, recipient ${index! + 1}: ${who}. What would you like to change?`
          : `What ${edit.missing} should I use for ${who}?`;
    else {
      proposals = draft!.rows.map((p, i) => ({
        ...p,
        ...(i === index ? patch : {}),
        warnings: ["Review these edited instructions before verification."],
      }));
      selectionRows = proposals;
      if (
        draft!.batch ||
        proposals.every(
          (p) =>
            p.name.trim() && p.bankCode && p.accountNumber && p.amountNaira,
        )
      ) {
        const instructions = proposals.map((p) => ({
          name: p.name,
          bankCode: p.bankCode,
          accountNumber: p.accountNumber,
          amountKobo: nairaToKobo(p.amountNaira!),
          reason: p.reason,
        }));
        const updated = draft!.batch
          ? await editBatch(
              actor,
              draft!.batch.id,
              instructions,
              draft!.batch.version,
            )
          : await preparePaymentBatch(
              actor,
              instructions,
              draft!.message!.id,
              draft!.rows,
            );
        selectionRows = batchRows(updated);
        batchId = updated.id;
        proposals = [];
      }
      changed = true;
      reply = bankName
        ? `Changed the selected institution for ${who} to ${bankName}. The recipient label and account number stay as entered. Review the details and verify the beneficiary again.`
        : `Updated the draft for ${who}. Review the details below${batchId ? "; verification and any previous approval have been cleared" : ""}. Nothing has been submitted.`;
    }
  }
  const messageId = id();
  await mutate((s) => {
    if (changed && draft?.message && !draft.batch && !batchId) {
      const original = s.messages.find(
        (m) => m.id === draft.message!.id && m.owner === actor,
      );
      if (
        !original ||
        original.batchId ||
        original.supersededBy ||
        fingerprint(original.proposals ?? []) !== fingerprint(draft.rows)
      )
        throw new AppError(
          "This draft changed while you were editing. Review its latest card and try again.",
          409,
        );
      original.supersededBy = messageId;
    }
    if (changed && batchId) {
      s.messages
        .filter((m) => m.owner === actor && m.batchId === batchId)
        .forEach((m) => {
          m.supersededBy = messageId;
        });
    }
    s.messages.push(
      { id: id(), owner: actor, role: "user", content: text, at: now() },
      {
        id: messageId,
        owner: actor,
        role: "assistant",
        content: reply,
        at: now(),
        compositionVersion: 1,
        generation: "manual",
        topic: "prepare",
        proposals,
        batchId,
        sourceRequest: draft?.message?.sourceRequest ?? text,
        ...(validTarget
          ? {
              draftSelection: {
                draftId: changed ? (batchId ?? messageId) : draft!.key,
                recipientIndex: index!,
                fingerprint: fingerprint(selectionRows ?? draft!.rows),
              },
            }
          : {}),
      },
    );
  });
  return { reply, proposals, batchId, messageId, aiEnabled };
}
