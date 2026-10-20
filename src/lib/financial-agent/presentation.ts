import { z } from "zod";

const Metric = z.object({
  label: z.string().min(1),
  value: z.string().regex(/^(?:-?₦[\d,]+\.\d{2}|Unavailable)$/),
});
const Record = z.object({
  name: z.string(),
  amount: z.string(),
  direction: z.enum(["debit", "credit"]),
  date: z.string().datetime().nullable(),
  status: z.string(),
  account: z.string(),
  choice: z.string().optional(),
});
export const FinancialPresentationSchema = z.object({
  version: z.literal(1),
  narration: z.enum(["ai", "factual_fallback"]),
  explanation: z.array(z.string()).min(1),
  results: z
    .array(
      z
        .object({
          resultId: z.string(),
          type: z.enum([
            "calculate_spending",
            "search_transactions",
            "get_transaction",
            "find_payment_evidence",
            "get_account_summary",
          ]),
          metrics: z.array(Metric),
          records: z.array(Record),
          scope: z.string(),
          limits: z.array(z.string()),
          sources: z.array(
            z.object({ provider: z.string(), mode: z.string() }),
          ),
          asOf: z.string().datetime(),
          coverage: z.string(),
          originalText: z.string(),
        })
        .refine(
          (r) => r.type !== "calculate_spending" || r.metrics.length === 3,
          "Incomplete spending presentation",
        ),
    )
    .min(1)
    .max(5),
});
export type FinancialPresentation = z.infer<typeof FinancialPresentationSchema>;
export type PresentedResult = FinancialPresentation["results"][number];
