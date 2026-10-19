import { Dashboard } from "@/components/dashboard";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const origin =
    typeof params.fromChat === "string" &&
    /^[a-f0-9-]{36}$/i.test(params.fromChat)
      ? params.fromChat
      : "";
  const conversationHref =
    process.env.FINANCIAL_DEMO_ENABLED === "true" && config().mode === "fixture"
      ? `/conversation${origin ? `?chat=${encodeURIComponent(origin)}` : ""}`
      : undefined;
  return (
    <>
      <Dashboard
        paymentMode={config().mode}
        conversationHref={conversationHref}
      />
    </>
  );
}
