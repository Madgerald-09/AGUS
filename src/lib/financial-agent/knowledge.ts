import type { z } from "zod";
import type { ProductTopicSchema } from "./protocol";

/** Reviewed code-local product facts only. No external retrieval or user-writable knowledge. */
export const PRODUCT_KNOWLEDGE = Object.freeze({
  version: "agus-product-v1.0.0",
  reviewedAt: "2026-10-18",
  source:
    "Agent B isolated-module capability manifest; docs/phase1/ARCHITECTURE_CONTRACTS.md",
  entries: Object.freeze({
    overview:
      "AGUS can support general conversation and permission-checked financial reads. This Phase 2B module is isolated; application integration is still required.",
    data: "The supplied financial dataset is fictional. Financial responses must identify source, mode, freshness and coverage. Wema and Mono account connections are not verified or supplied by this module.",
    payments:
      "Payment requests are handed to the existing editable draft workflow. This module cannot verify beneficiaries, approve, submit, retry or execute payments. The existing workflow requires its own review and authorization.",
    privacy:
      "Financial access requires current account permissions and consent. Follow-up selections expire and are rechecked. Real-data model disclosure, retention and deletion require integration review; data already sent to a model cannot be recalled.",
    unknown:
      "This product knowledge version does not establish that capability. I can explain the documented conversation, financial-read, payment-draft and privacy boundaries.",
  }),
});
export function productAnswer(topic: z.infer<typeof ProductTopicSchema>) {
  return `${PRODUCT_KNOWLEDGE.entries[topic]} [Product source: ${PRODUCT_KNOWLEDGE.version}, reviewed ${PRODUCT_KNOWLEDGE.reviewedAt}]`;
}
