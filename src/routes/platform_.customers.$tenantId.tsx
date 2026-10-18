import { createFileRoute } from "@tanstack/react-router";
import { CustomerFile } from "@/components/platform/CustomerFile";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";

/**
 * חלק 42: /platform/customers/{tenantId} — תיק לקוח מרכזי של בעל חנות
 * (הסכמים וחתימות, מסמכים וחשבוניות, מיילים, מנוי ויומן פעולות).
 * מנהל-על בלבד: ה-PlatformShell בודק, וכל פונקציית שרת בודקת שוב + RLS במסד.
 */
export const Route = createFileRoute("/platform_/customers/$tenantId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `תיק לקוח · ${PLATFORM_SITE_NAME}` }, { name: "robots", content: "noindex" }],
  }),
  component: CustomerFilePage,
});

function CustomerFilePage() {
  const { tenantId } = Route.useParams();
  return (
    <PlatformShell active="stores">{() => <CustomerFile tenantId={tenantId} />}</PlatformShell>
  );
}
