import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PlatformTerminalCard } from "@/platform/billing/ui/PlatformTerminalCard";

// MAX/Hyp DEMO (D5) — "מסוף הפלטפורמה": NURIEL's own terminal (platform admin, platform host). Every action is
// checked again on the server (platform host, session, step-up) and in the DB (platform admin).
export const Route = createFileRoute("/platform_/payments")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `מסוף הפלטפורמה · ${PLATFORM_SITE_NAME}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlatformPaymentsPage,
});

function PlatformPaymentsPage() {
  return <PlatformShell active="payments">{() => <PlatformTerminalCard />}</PlatformShell>;
}
