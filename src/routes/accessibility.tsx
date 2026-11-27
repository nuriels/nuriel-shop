import { createFileRoute, Link } from "@tanstack/react-router";
import { Accessibility } from "lucide-react";
import { InfoPage } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { Card, CardContent } from "@/components/ui/card";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { getStorePageSeo } from "@/lib/pages.functions";
import { isServerRender, StorefrontSeedProvider } from "@/lib/storefront-seed";
import { getStorefrontSeed } from "@/lib/storefront-seed.functions";

/**
 * חלק 40: הצהרת נגישות — תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות
 * נגישות לשירות), תקנה 35: אתר שנותן שירות לציבור מפרסם הצהרת נגישות.
 *
 * אם החנות כתבה עמוד משלה ב"עמודים" (כתובת accessibility) — הוא מוצג. אחרת —
 * הצהרה בסיסית עם פרטי העסק ודרכי הפנייה בנושא נגישות.
 */
const SLUG = "accessibility";

export const Route = createFileRoute("/accessibility")({
  // נבנה בשרת: ההצהרה (העמוד שהחנות כתבה, או ההצהרה הבסיסית עם פרטי העסק) כבר ב-HTML — לגוגל,
  // לכלי AI ולקוראי מסך בלי JavaScript. קודם היה ב-HTML רק "טוען…" (ההצהרה נטענה בדפדפן).
  // הכותרת והתיאור לגוגל — ב-root (static-pages-seo.ts): "שם העמוד | שם החנות" ותיאור משלו
  ssr: true,
  loader: async ({ context }) => {
    const store = context.hostMode.siteType === "ecommerce";
    const [page, seed] = await Promise.all([
      // רק עמוד שפורסם (טיוטה לא מחליפה את ההצהרה). תקלה — ההצהרה הבסיסית, כמו קודם בדפדפן
      store ? getStorePageSeo({ data: { slug: SLUG } }).catch(() => null) : Promise.resolve(null),
      isServerRender() && store ? getStorefrontSeed({ data: {} }) : Promise.resolve(null),
    ]);
    return { custom: page?.content_html?.trim() ? page.content_html : null, seed };
  },
  component: SeededAccessibilityStatementPage,
});

function SeededAccessibilityStatementPage() {
  const { seed } = Route.useLoaderData();
  return (
    <StorefrontSeedProvider seed={seed}>
      <AccessibilityStatementPage />
    </StorefrontSeedProvider>
  );
}

function AccessibilityStatementPage() {
  const { settings } = useSiteSettings();
  const { custom } = Route.useLoaderData();

  const store = settings?.business_name?.trim() || settings?.site_title?.trim() || "החנות";
  const phone = settings?.support_phone?.trim() || settings?.business_phone?.trim() || "";
  const email = settings?.business_email?.trim() || "";

  return (
    <InfoPage title="הצהרת נגישות" icon={<Accessibility aria-hidden="true" />}>
      <Card className="shadow-card">
        <CardContent
          className="space-y-3 pt-5 text-sm leading-7"
          data-testid="accessibility-statement"
        >
          {custom ? (
            <RichContent content={custom} />
          ) : (
            <>
              <p>
                {store} רואה חשיבות במתן שירות שוויוני לכלל הלקוחות, ובכלל זה לאנשים עם מוגבלות.
                האתר נבנה מתוך מטרה לעמוד בדרישות תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות
                נגישות לשירות), התשע"ג-2013, ובתקן הישראלי ת"י 5568 (המבוסס על הנחיות WCAG 2.0) ברמה
                AA.
              </p>
              <h2 className="pt-2 text-base font-bold">מה נעשה באתר</h2>
              <ul className="list-disc space-y-1 pr-5">
                <li>האתר בעברית ומותאם לכיוון כתיבה מימין לשמאל, לטלפון, לטאבלט ולמחשב.</li>
                <li>אפשר לנווט בכל חלקי האתר באמצעות המקלדת, כולל קישור "דלג לתוכן הראשי".</li>
                <li>לתמונות ולכפתורים יש תיאור טקסטואלי לתוכנות הקראת מסך.</li>
                <li>
                  כפתור "תפריט נגישות" בפינת המסך: הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים והדגשת
                  המיקום במקלדת.
                </li>
                <li>טפסים עם תוויות ברורות והודעות שגיאה שמוקראות לתוכנות הקראת מסך.</li>
              </ul>
              <h2 className="pt-2 text-base font-bold">מגבלות ידועות</h2>
              <p>
                ייתכן שחלק מהתכנים באתר (למשל תמונות מוצרים או מסמכים שהועלו ממקורות חיצוניים) עדיין
                אינם נגישים במלואם. אנו פועלים לשפר את הנגישות באופן שוטף.
              </p>
              <h2 className="pt-2 text-base font-bold">פנייה בנושא נגישות</h2>
              <p>
                נתקלתם בקושי או בתוכן שאינו נגיש? נשמח לשמוע ולתקן. אפשר לפנות אלינו
                {phone && (
                  <>
                    {" "}
                    בטלפון <span dir="ltr">{phone}</span>
                  </>
                )}
                {email && (
                  <>
                    {phone ? "," : ""} במייל{" "}
                    <a href={`mailto:${email}`} className="text-primary underline" dir="ltr">
                      {email}
                    </a>
                  </>
                )}{" "}
                או דרך{" "}
                <Link to="/contact" className="text-primary underline">
                  עמוד צור קשר
                </Link>
                . כדי שנוכל לטפל בפנייה, נשמח לפירוט: תיאור הבעיה, באיזה עמוד, ובאיזה דפדפן או
                טכנולוגיה מסייעת השתמשתם.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </InfoPage>
  );
}
