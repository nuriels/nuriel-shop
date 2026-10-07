import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EyeOff, FileQuestion, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { loadStorePage } from "@/lib/pages-data";
import { getStorePageSeo } from "@/lib/pages.functions";
import { breadcrumbTrail, canonicalUrl } from "@/lib/seo-urls";
import { breadcrumbJsonLd, jsonLdText } from "@/lib/structured-data";

/**
 * /pages/<slug> — עמוד תוכן של החנות (חלק 30): מדיניות משלוחים, שאלות
 * נפוצות וכו', כפי שבעל החנות כתב בלשונית "עמודי תוכן". החנות נקבעת לפי
 * הדומיין (סאב-דומיין או דומיין אישי), כך שאותה כתובת בחנויות שונות מציגה
 * עמודים שונים. התוכן מנוקה לפני ההצגה (RichContent → DOMPurify).
 *
 * חלק 31: "data-only" — העמוד נטען בשרת, כך שהכותרת, התיאור, הכתובת הקנונית
 * (מה-root) ופירורי הלחם (JSON-LD) כבר ב-HTML שגוגל מקבל. טיוטה — רק למנהל,
 * נטענת בדפדפן עם ההרשאות שלו.
 */
export const Route = createFileRoute("/pages/$slug")({
  ssr: "data-only",
  loader: async ({ params }) => ({
    page: await getStorePageSeo({ data: { slug: params.slug } }),
  }),
  head: ({ loaderData }) => {
    const page = loaderData?.page ?? null;
    if (!page) {
      return { meta: [{ title: "העמוד לא נמצא" }, { name: "robots", content: "noindex" }] };
    }
    const title = `${page.title} | ${page.storeName}`;
    return {
      meta: [
        { title },
        { name: "description", content: page.description },
        { property: "og:title", content: title },
        { property: "og:description", content: page.description },
        { property: "og:type", content: "article" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: page.description },
      ],
      // הכתובת הקנונית — רק לעמוד שפורסם (ה-root מדלג על עמודי תוכן)
      links: (() => {
        const href = canonicalUrl(page.origin, `/pages/${page.slug}`);
        return href ? [{ rel: "canonical", href }] : [];
      })(),
      scripts: page.origin
        ? [
            {
              type: "application/ld+json",
              children: jsonLdText(
                breadcrumbJsonLd(breadcrumbTrail(page.origin, page.storeName, [], page.title)),
              ),
            },
          ]
        : [],
    };
  },
  component: StorePageView,
});

type ViewPage = { title: string; content_html: string; is_published: boolean; updated_at: string };

function StorePageView() {
  const { slug } = Route.useParams();
  const { page: published } = Route.useLoaderData();
  // לא פורסם / לא קיים — אולי טיוטה שהמנהל מסתכל עליה (ההרשאות במסד)
  const [draft, setDraft] = useState<ViewPage | null | undefined>(published ? null : undefined);

  useEffect(() => {
    if (published) return;
    let alive = true;
    setDraft(undefined);
    loadStorePage(slug)
      .then((page) => alive && setDraft(page))
      .catch(() => alive && setDraft(null));
    return () => {
      alive = false;
    };
  }, [published, slug]);

  const page: ViewPage | null = published ?? draft ?? null;

  if (!page) {
    if (draft === undefined) {
      return (
        <InfoPage title="טוען…" icon={<FileText aria-hidden="true" />}>
          <LoadingLine />
        </InfoPage>
      );
    }
    return (
      <InfoPage title="העמוד לא נמצא" icon={<FileQuestion aria-hidden="true" />}>
        <Card className="shadow-card">
          <CardContent className="space-y-4 pt-5 text-sm text-muted-foreground">
            <p>העמוד שחיפשתם לא קיים או שהוסר מהאתר.</p>
            <Button asChild>
              <Link to="/">חזרה לחנות</Link>
            </Button>
          </CardContent>
        </Card>
      </InfoPage>
    );
  }

  const updated = new Date(page.updated_at).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });

  return (
    <InfoPage title={page.title} icon={<FileText aria-hidden="true" />}>
      {!page.is_published && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <EyeOff className="size-4 shrink-0" aria-hidden="true" />
          טיוטה — העמוד לא מפורסם, ורק מנהלי החנות רואים אותו.
        </p>
      )}
      <Card className="shadow-card">
        <CardContent className="pt-5" data-testid="store-page-content">
          <RichContent content={page.content_html} />
          {page.content_html.trim() === "" && (
            <p className="text-sm text-muted-foreground">אין עדיין תוכן בעמוד הזה.</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">עודכן לאחרונה: {updated}</p>
    </InfoPage>
  );
}
