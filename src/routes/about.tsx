import { createFileRoute } from "@tanstack/react-router";
import { Clock, Mail, Monitor, Phone, ShieldCheck } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { APP_VERSION } from "@/lib/branding";
import { ORDER_HOURS } from "@/lib/order-hours";

export const Route = createFileRoute("/about")({
  ssr: false,
  head: () => ({ meta: [{ title: "אודות ויצירת קשר" }] }),
  component: AboutPage,
});

/** עמוד אודות ויצירת קשר — ציבורי, כולל הצהרת נגישות */
function AboutPage() {
  const { settings } = useSiteSettings();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <Card className="shadow-card">
          <CardContent className="space-y-3 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Monitor className="size-5 text-primary" aria-hidden="true" />
              על העסק
            </h2>
            <p className="whitespace-pre-line leading-7 text-foreground">
              {settings?.about_content?.trim() ||
                `${settings?.site_title ?? "העסק"} — פורטל הזמנות סיטונאי ללקוחות עסקיים.`}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="space-y-3 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Clock className="size-5 text-primary" aria-hidden="true" />
              שעות קבלת הזמנות וטיפול
            </h2>
            <p className="leading-7 text-foreground">{ORDER_HOURS.about}</p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardContent className="space-y-3 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Phone className="size-5 text-primary" aria-hidden="true" />
              יצירת קשר
            </h2>
            {settings?.contact_content?.trim() && (
              <p className="whitespace-pre-line leading-7 text-foreground">
                {settings.contact_content}
              </p>
            )}
            {settings?.business_phone && (
              <p className="flex items-center gap-2 text-foreground">
                <Phone className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <a
                  href={`tel:${settings.business_phone}`}
                  dir="ltr"
                  className="font-semibold text-primary hover:underline"
                >
                  {settings.business_phone}
                </a>
              </p>
            )}
            {settings?.business_email && (
              <p className="flex items-center gap-2 text-foreground">
                <Mail className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <a
                  href={`mailto:${settings.business_email}`}
                  dir="ltr"
                  className="font-semibold text-primary hover:underline"
                >
                  {settings.business_email}
                </a>
              </p>
            )}
            {settings?.business_address && (
              <p className="text-foreground">{settings.business_address}</p>
            )}
          </CardContent>
        </Card>

        <Card id="accessibility" className="scroll-mt-4 shadow-card">
          <CardContent className="space-y-3 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              הצהרת נגישות
            </h2>
            <p className="leading-7 text-foreground">
              אנו רואים חשיבות רבה במתן שירות שוויוני ונגיש לכלל המשתמשים, ופועלים להתאמת המערכת
              לתקן הנגישות הישראלי (ת"י 5568) ברמת WCAG 2.0 AA ולתקנות שוויון זכויות לאנשים עם
              מוגבלות (התאמות נגישות לשירות), תשע"ג-2013. באתר פועל תפריט נגישות צף (הכפתור העגול
              בפינת המסך) המאפשר הגדלה והקטנה של הטקסט, מצבי ניגודיות גבוהה וצבעים נגדיים, הדגשת
              קישורים וניווט מקלדת ברור.
            </p>
            <p className="leading-7 text-muted-foreground">
              נתקלתם ברכיב שאינו נגיש או בקושי בשימוש? נשמח לתקן —{" "}
              {settings?.business_phone ? (
                <>
                  פנו אלינו בטלפון{" "}
                  <a
                    href={`tel:${settings.business_phone}`}
                    dir="ltr"
                    className="text-primary hover:underline"
                  >
                    {settings.business_phone}
                  </a>
                </>
              ) : (
                "פנו אלינו בפרטי הקשר שלמעלה"
              )}{" "}
              ונטפל בהקדם.
            </p>
          </CardContent>
        </Card>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          © כל הזכויות שמורות ל{settings?.site_title ?? "העסק"} ·{" "}
          <span dir="ltr">גרסה {APP_VERSION}</span>
        </p>
      </main>

      <AppFooter />
    </div>
  );
}
