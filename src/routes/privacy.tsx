import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { legalContentOrDefault } from "@/lib/legal-content";

export const Route = createFileRoute("/privacy")({
  ssr: false,
  head: () => ({ meta: [{ title: "מדיניות פרטיות" }] }),
  component: PrivacyPage,
});

/** מדיניות הפרטיות — הנוסח מלשונית "עמודים משפטיים" בפאנל (או ברירת המחדל) */
function PrivacyPage() {
  const { settings } = useSiteSettings();
  return (
    <InfoPage title="מדיניות פרטיות" icon={<Lock aria-hidden="true" />}>
      <Card className="shadow-card">
        <CardContent className="pt-5">
          {settings ? (
            <RichContent content={legalContentOrDefault("privacy", settings.privacy_content)} />
          ) : (
            <LoadingLine />
          )}
        </CardContent>
      </Card>
    </InfoPage>
  );
}
