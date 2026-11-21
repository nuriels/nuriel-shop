import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { SeoPlatformPanel } from "@/components/platform/seo/SeoPlatformPanel";

// NURIEL AI SEO ENGINE — "SEO" בפאנל מנהל העל: מספרים לכל עסק בלבד. ההרשאה נבדקת בשרת ובמסד בכל פעולה.
export const Route = createFileRoute("/platform_/seo")({
  ssr: false,
  head: () => ({
    meta: [{ title: `SEO · ${PLATFORM_SITE_NAME}` }, { name: "robots", content: "noindex" }],
  }),
  component: SeoPage,
});

function SeoPage() {
  return <PlatformShell active="seo">{() => <SeoPlatformPanel />}</PlatformShell>;
}
