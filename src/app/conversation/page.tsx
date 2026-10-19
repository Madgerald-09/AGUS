import { FinancialConversation } from "@/components/financial-conversation";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function Page() {
  return <FinancialConversation paymentMode={config().mode} />;
}
