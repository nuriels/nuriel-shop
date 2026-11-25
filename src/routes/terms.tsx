import { createFileRoute } from "@tanstack/react-router";
import { isServerRender, StorefrontSeedProvider } from "@/lib/storefront-seed";
import { getStorefrontSeed } from "@/lib/storefront-seed.functions";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { legalPageHtml } from "@/lib/legal-content";

export const Route = createFileRoute("/terms")({
  // נבנה בשרת (SEO): ההגדרות הציבוריות (טקסטים, פרטי העסק) והקטגוריות — מה שאורח רואה — כבר ב-HTML.
  // רק בטעינה הראשונה; בניווט בתוך האתר הדפדפן טוען בעצמו, כמו קודם
  ssr: true,
  loader: ({ context }) =>
    isServerRender() && context.hostMode.siteType === "ecommerce"
      ? getStorefrontSeed({ data: {} })
      : null,
  // הכותרת והתיאור לגוגל — ב-root (static-pages-seo.ts): "שם העמוד | שם החנות" ותיאור משלו
  component: SeededTermsPage,
});

/** תקנון האתר — הנוסח מלשונית "עמודים משפטיים" בפאנל (או נוסח ברירת המחדל) */
function TermsPage() {
  const { settings } = useSiteSettings();
  return (
    <InfoPage title="תקנון האתר" icon={<FileText aria-hidden="true" />}>
      <Card className="shadow-card">
        <CardContent className="px-5 pt-6 sm:px-8 sm:pb-8">
          {settings ? (
            <RichContent
              variant="document"
              content={legalPageHtml("terms", settings.terms_content, settings)}
            />
          ) : (
            <LoadingLine />
          )}
        </CardContent>
      </Card>
    </InfoPage>
  );
}

function SeededTermsPage() {
  return (
    <StorefrontSeedProvider seed={Route.useLoaderData()}>
      <TermsPage />
    </StorefrontSeedProvider>
  );
}
