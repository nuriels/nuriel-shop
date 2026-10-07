import { createFileRoute, Link } from "@tanstack/react-router";
import { EyeOff, FileQuestion, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPage } from "@/components/legal/InfoPage";
import { RichContent } from "@/components/legal/RichContent";
import { loadStorePage } from "@/lib/pages-data";
import { richTextToPlain } from "@/lib/rich-text";

/**
 * /pages/<slug> — עמוד תוכן של החנות (חלק 30): מדיניות משלוחים, שאלות
 * נפוצות וכו', כפי שבעל החנות כתב בלשונית "עמודי תוכן". החנות נקבעת לפי
 * הדומיין (סאב-דומיין או דומיין אישי), כך שאותה כתובת בחנויות שונות מציגה
 * עמודים שונים. התוכן מנוקה לפני ההצגה (RichContent → DOMPurify).
 */
export const Route = createFileRoute("/pages/$slug")({
  ssr: false,
  loader: async ({ params }) => ({ page: await loadStorePage(params.slug) }),
  head: ({ loaderData }) => {
    const page = loaderData?.page ?? null;
    if (!page)
      return { meta: [{ title: "העמוד לא נמצא" }, { name: "robots", content: "noindex" }] };
    const description = richTextToPlain(page.content_html).slice(0, 160);
    return {
      meta: [
        { title: page.title },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: page.title },
        // טיוטה (רק מנהל רואה) — לא לאינדקס
        ...(page.is_published ? [] : [{ name: "robots", content: "noindex" }]),
      ],
    };
  },
  component: StorePageView,
});

function StorePageView() {
  const { page } = Route.useLoaderData();

  if (!page) {
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
