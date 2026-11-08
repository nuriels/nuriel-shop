import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { AiAdminPanel } from "@/components/platform/ai/AiAdminPanel";

// NURIEL AI ASSISTANT — "ניהול תוסף AI" בפאנל מנהל העל. ההרשאה נבדקת בשרת בכל פעולה (ושוב במסד).
export const Route = createFileRoute("/platform_/ai")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `ניהול תוסף AI · ${PLATFORM_SITE_NAME}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiPage,
});

function AiPage() {
  return <PlatformShell active="ai">{() => <AiAdminPanel />}</PlatformShell>;
}
