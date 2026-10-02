import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { defaultPrivacyPolicy } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  ssr: false,
  head: () => ({ meta: [{ title: "מדיניות פרטיות" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { settings } = useSiteSettings();
  const content =
    settings?.privacy_content?.trim() ||
    defaultPrivacyPolicy({
      businessName: settings?.business_name ?? "",
      taxId: settings?.business_tax_id ?? "",
      address: settings?.business_address ?? "",
      phone: settings?.business_phone ?? "",
      email: settings?.business_email ?? "",
      sellsAlcohol: settings?.sells_alcohol ?? true,
    });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Card className="shadow-card">
          <CardContent className="space-y-3 pt-5">
            <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
              <Lock className="size-5 text-primary" aria-hidden="true" />
              מדיניות פרטיות
            </h1>
            <p className="whitespace-pre-line text-sm leading-7 text-foreground">{content}</p>
          </CardContent>
        </Card>
      </main>
      <AppFooter />
    </div>
  );
}
