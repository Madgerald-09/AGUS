import Link from "next/link";
import { Dashboard } from "@/components/dashboard";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <>
      {process.env.FINANCIAL_DEMO_ENABLED === "true" &&
        config().mode === "fixture" && (
          <Link href="/conversation">Open financial conversation</Link>
        )}
      <Dashboard paymentMode={config().mode} />
    </>
  );
}
