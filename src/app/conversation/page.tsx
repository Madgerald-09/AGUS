import Link from "next/link";
import { FinancialConversation } from "@/components/financial-conversation";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export default function Page() {
  if (
    process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
    config().mode !== "fixture"
  )
    return (
      <main>
        <p>Financial conversation is unavailable.</p>
        <Link href="/">Back to workspace</Link>
      </main>
    );
  return <FinancialConversation />;
}
