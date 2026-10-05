import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { legalContentOrDefault } from "@/lib/legal-content";

export const Route = createFileRoute("/terms")({
  ssr: false,
  head: () => ({ meta: [{ title: "תקנון האתר" }] }),
  component: TermsPage,
});

/** תקנון האתר — הנוסח מלשונית "עמודים משפטיים" בפאנל (או נוסח ברירת המחדל) */
function TermsPage() {
  const { settings } = useSiteSettings();
  return (
    <InfoPage title="תקנון האתר" icon={<FileText aria-hidden="true" />}>
      <Card className="shadow-card">
        <CardContent className="pt-5">
          {settings ? (
            <RichContent content={legalContentOrDefault("terms", settings.terms_content)} />
          ) : (
            <LoadingLine />
          )}
        </CardContent>
      </Card>
    </InfoPage>
  );
}
