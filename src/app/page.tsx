import { Dashboard } from "@/components/dashboard";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Dashboard paymentMode={config().mode} />;
}
