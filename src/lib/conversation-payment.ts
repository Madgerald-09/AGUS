import { isDeepStrictEqual } from "node:util";
import { chatHistory } from "./chat-history/store";
import { mutate, readState } from "./db";
import { AppError, now, type Message } from "./domain";
import { extractConversationPayment } from "./intelligence";

/** Payment preparation retains its source in the existing payment store; saved
 * conversational transcripts deliberately redact long account numbers. */
export async function rememberConversationPayment(
  owner: string,
  chatId: string,
  turnId: string,
  sourceRequest: string,
) {
  await mutate((s) => {
    if (s.messages.some((m) => m.id === turnId && m.owner === owner)) return;
    s.messages.push({
      id: turnId,
      owner,
      role: "assistant",
      at: now(),
      compositionVersion: 1,
      generation: "manual",
      topic: "payment_source",
      content: "Payment preparation available.",
      sourceRequest,
      conversationId: chatId,
      turnId,
    });
  });
}

/** A durable blank proposal is committed before inference. Reopening the same
 * turn never repeats inference or creates another payment. After interruption,
 * the user can complete the saved card manually. No authority comes from AI. */
export async function conversationPayment(
  owner: string,
  chatId: string,
  turnId: string,
) {
  const turn = (await chatHistory(owner).read(chatId)).find(
    (t) => t.id === turnId,
  );
  if (!turn?.reply.handoff)
    throw new AppError("Payment preparation not found", 404);
  const initial: NonNullable<Message["proposals"]> = [
    {
      name: "",
      bankCode: null,
      accountNumber: null,
      amountNaira: null,
      reason: "Payment",
      confidence: "low",
      warnings: [
        "Unverified draft. Complete and review every field before saving.",
      ],
    },
  ];
  const claimed = await mutate((s) => {
    const existing = s.messages.find(
      (m) => m.id === turnId && m.owner === owner,
    );
    if (existing && existing.topic !== "payment_source")
      return { claimed: false, source: existing.sourceRequest ?? turn.text };
    if (existing) {
      existing.topic = "prepare";
      existing.proposals = initial;
      return { claimed: true, source: existing.sourceRequest ?? turn.text };
    }
    s.messages.push({
      id: turnId,
      owner,
      role: "assistant",
      at: now(),
      compositionVersion: 1,
      generation: "manual",
      topic: "prepare",
      content: "Review your payment details.",
      sourceRequest: turn.text,
      conversationId: chatId,
      turnId,
      proposals: initial,
    });
    return { claimed: true, source: turn.text };
  });
  if (claimed.claimed) {
    try {
      const proposals = await extractConversationPayment(claimed.source);
      if (proposals.length)
        await mutate((s) => {
          const message = s.messages.find(
            (m) => m.id === turnId && m.owner === owner,
          )!;
          // Do not overwrite edits or a batch saved while extraction was running.
          if (!message.batchId && isDeepStrictEqual(message.proposals, initial))
            message.proposals = proposals;
        });
    } catch {
      // The blank durable card remains usable; never replay uncertain creation.
    }
  }
  return (await readState()).messages.find(
    (m) => m.id === turnId && m.owner === owner,
  )!;
}
