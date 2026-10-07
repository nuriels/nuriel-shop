import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  ExternalLink,
  FilePlus2,
  FileText,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/legal/RichTextEditor";
import { refreshStorePages } from "@/hooks/useStorePages";
import {
  PAGE_LIMITS,
  PAGE_TEMPLATES,
  pagePath,
  pageSlugProblem,
  pageTitleProblem,
  slugifyTitle,
  uniqueSlug,
  type PageTemplate,
  type StorePage,
} from "@/lib/pages";
import {
  deletePage,
  loadAllPages,
  savePage,
  savePageOrder,
  setPagePublished,
  type PageDraft,
} from "@/lib/pages-data";
import { countRedMarks, richTextIsEmpty } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

type EditorTarget = { id: string | null; draft: PageDraft };

const BLANK: PageDraft = { title: "", slug: "", content_html: "", is_published: true };

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
}

/**
 * לשונית "עמודי תוכן" (/admin/pages, חלק 30): עמודי מידע שבעל החנות כותב
 * בעצמו — מדיניות משלוחים, שאלות נפוצות וכו'. כל עמוד מוצג ב-/pages/<slug>,
 * והעמודים שפורסמו מופיעים בתחתית האתר תחת "מידע שימושי".
 */
export function PagesPanel() {
  const [pages, setPages] = useState<StorePage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StorePage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPages(await loadAllPages());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "טעינת העמודים נכשלה");
      setPages((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** אחרי כל שינוי — הרשימה כאן, והתחתית של האתר */
  const changed = useCallback(async () => {
    await load();
    void refreshStorePages();
  }, [load]);

  const slugs = useMemo(() => (pages ?? []).map((page) => page.slug), [pages]);
  const atLimit = (pages?.length ?? 0) >= PAGE_LIMITS.pagesPerStore;

  const startNew = (template?: PageTemplate) => {
    const draft: PageDraft = template
      ? {
          title: template.title,
          slug: uniqueSlug(template.slug, slugs),
          content_html: template.content,
          is_published: true,
        }
      : BLANK;
    setEditing({ id: null, draft });
  };

  const togglePublished = async (page: StorePage, published: boolean) => {
    setBusyId(page.id);
    // עדכון מיידי בתצוגה, ואם נכשל — חוזרים
    setPages((list) =>
      list ? list.map((p) => (p.id === page.id ? { ...p, is_published: published } : p)) : list,
    );
    try {
      await setPagePublished(page.id, published);
      toast.success(published ? `"${page.title}" פורסם באתר` : `"${page.title}" הוסתר מהאתר`);
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העדכון נכשל");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    if (!pages) return;
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setPages(next);
    setBusyId(next[target]!.id);
    try {
      await savePageOrder(next);
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שינוי הסדר נכשל");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const page = pendingDelete;
    if (!page) return;
    setPendingDelete(null);
    setBusyId(page.id);
    try {
      await deletePage(page.id);
      toast.success(`העמוד "${page.title}" נמחק`);
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "המחיקה נכשלה");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="pages-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="pages-title" className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="size-6 text-primary" aria-hidden="true" />
            עמודי תוכן
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            עמודי מידע לחנות — מדיניות משלוחים, החזרות, שאלות נפוצות ועוד. עמוד שמפורסם מופיע בתחתית
            האתר תחת &quot;מידע שימושי&quot;. התקנון, מדיניות הפרטיות ומדיניות הביטולים מנוהלים
            בלשונית &quot;עמודים משפטיים&quot;.
          </p>
        </div>
        <Button onClick={() => startNew()} disabled={atLimit} data-testid="new-page">
          <FilePlus2 className="size-4" aria-hidden="true" />
          עמוד חדש
        </Button>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {pages === null ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" aria-label="טוען עמודים" />
      ) : pages.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">עוד אין עמודי תוכן</CardTitle>
            <CardDescription>
              אפשר להתחיל מעמוד ריק, או מתבנית מוכנה ולעדכן את מה שמסומן באדום.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PAGE_TEMPLATES.map((template) => (
              <Button
                key={template.key}
                variant="outline"
                onClick={() => startNew(template)}
                data-testid={`template-${template.key}`}
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                {template.title}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table data-testid="pages-table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">עמוד</TableHead>
                <TableHead className="w-16 text-right sm:w-24">מפורסם</TableHead>
                <TableHead className="hidden w-32 text-right md:table-cell">עודכן</TableHead>
                <TableHead className="text-left">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page, index) => (
                <TableRow key={page.id} data-page-slug={page.slug}>
                  <TableCell className="max-w-[9.5rem] py-3 sm:max-w-none">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: page.id,
                          draft: {
                            title: page.title,
                            slug: page.slug,
                            content_html: page.content_html,
                            is_published: page.is_published,
                          },
                        })
                      }
                      className="block max-w-full truncate text-right font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {page.title}
                    </button>
                    <a
                      href={pagePath(page.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
                    >
                      {pagePath(page.slug)}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                    {!page.is_published && (
                      <Badge variant="secondary" className="ms-2 align-middle text-[11px]">
                        טיוטה
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={page.is_published}
                      disabled={busyId === page.id}
                      onCheckedChange={(next) => void togglePublished(page, next)}
                      aria-label={`פרסום "${page.title}" באתר`}
                    />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                    {formatUpdated(page.updated_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={index === 0 || busyId !== null}
                        onClick={() => void move(index, -1)}
                        aria-label={`העברת "${page.title}" למעלה`}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={index === pages.length - 1 || busyId !== null}
                        onClick={() => void move(index, 1)}
                        aria-label={`העברת "${page.title}" למטה`}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() =>
                          setEditing({
                            id: page.id,
                            draft: {
                              title: page.title,
                              slug: page.slug,
                              content_html: page.content_html,
                              is_published: page.is_published,
                            },
                          })
                        }
                        aria-label={`עריכת "${page.title}"`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        disabled={busyId === page.id}
                        onClick={() => setPendingDelete(page)}
                        aria-label={`מחיקת "${page.title}"`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">תבניות מוכנות:</span>
            {PAGE_TEMPLATES.map((template) => (
              <Button
                key={template.key}
                variant="ghost"
                size="sm"
                disabled={atLimit}
                onClick={() => startNew(template)}
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                {template.title}
              </Button>
            ))}
            {atLimit && (
              <span className="text-xs text-muted-foreground">
                הגעתם ל-{PAGE_LIMITS.pagesPerStore} עמודים — מחקו עמוד כדי להוסיף חדש.
              </span>
            )}
          </div>
        </Card>
      )}

      <PageEditorDialog
        target={editing}
        takenSlugs={slugs}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await changed();
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>למחוק את העמוד &quot;{pendingDelete?.title}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              העמוד יוסר מהאתר ומ&quot;מידע שימושי&quot; בתחתית, וקישורים אליו יציגו &quot;העמוד לא
              נמצא&quot;. אי אפשר לשחזר. רוצים רק להסתיר אותו? כבו את &quot;מפורסם&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              מחיקה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** יצירה / עריכה: כותרת, כתובת (נוצרת אוטומטית מהכותרת), פרסום ותוכן */
function PageEditorDialog({
  target,
  takenSlugs,
  onClose,
  onSaved,
}: {
  target: EditorTarget | null;
  takenSlugs: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<PageDraft>(BLANK);
  // הכתובת עוקבת אחרי הכותרת עד שמשנים אותה ידנית (בעמוד קיים — לא נוגעים)
  const [slugTouched, setSlugTouched] = useState(false);
  const [htmlMode, setHtmlMode] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isNew = target?.id === null;
  // הכתובות של העמודים האחרים (בעמוד קיים — בלי הכתובת שלו עצמו)
  const otherSlugs = useMemo(
    () => takenSlugs.filter((slug) => isNew || slug !== target?.draft.slug),
    [isNew, takenSlugs, target],
  );

  useEffect(() => {
    if (!target) return;
    setDraft(target.draft);
    setSlugTouched(!isNew || target.draft.slug !== "");
    setHtmlMode(false);
    setProblem(null);
  }, [isNew, target]);

  const patch = (next: Partial<PageDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setProblem(null);
  };

  const setTitle = (title: string) => {
    if (slugTouched) patch({ title });
    else patch({ title, slug: title.trim() ? uniqueSlug(slugifyTitle(title), otherSlugs) : "" });
  };

  const redMarks = countRedMarks(draft.content_html);

  const submit = async () => {
    const slug = draft.slug.trim().toLowerCase();
    const issue =
      pageTitleProblem(draft.title) ??
      pageSlugProblem(slug) ??
      (otherSlugs.includes(slug)
        ? `כבר יש עמוד עם הכתובת ${pagePath(slug)} — בחרו כתובת אחרת`
        : null) ??
      (draft.content_html.length > PAGE_LIMITS.content ? "תוכן העמוד ארוך מדי" : null);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    try {
      const saved = await savePage(target?.id ?? null, { ...draft, slug });
      toast.success(
        isNew
          ? `העמוד "${saved.title}" נוצר${saved.is_published ? " ופורסם באתר" : " כטיוטה"}`
          : `העמוד "${saved.title}" נשמר`,
      );
      await onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] overflow-y-auto text-right sm:max-w-3xl"
        data-testid="page-editor"
      >
        <DialogHeader className="text-right">
          <DialogTitle>{isNew ? "עמוד חדש" : "עריכת עמוד"}</DialogTitle>
          <DialogDescription>
            הכותרת מוצגת בראש העמוד וב&quot;מידע שימושי&quot; בתחתית האתר.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="page-title">כותרת העמוד</Label>
            <Input
              id="page-title"
              value={draft.title}
              maxLength={PAGE_LIMITS.title}
              placeholder="למשל: מדיניות משלוחים"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="page-slug">כתובת העמוד (URL)</Label>
            <div
              dir="ltr"
              className="flex items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring"
            >
              <span className="shrink-0 border-e bg-muted px-3 py-2 text-sm text-muted-foreground">
                /pages/
              </span>
              <input
                id="page-slug"
                dir="ltr"
                value={draft.slug}
                maxLength={PAGE_LIMITS.slug}
                placeholder="shipping-policy"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setSlugTouched(true);
                  patch({ slug: event.target.value.toLowerCase().replace(/\s+/g, "-") });
                }}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              נוצרת אוטומטית מהכותרת, ואפשר לשנות: אותיות באנגלית קטנות, ספרות ומקפים.
              {!isNew && " שינוי הכתובת ישבור קישורים ישנים לעמוד."}
            </p>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">מפורסם באתר</span>
              <span className="block text-xs text-muted-foreground">
                כבוי = טיוטה: רק מנהלי החנות רואים את העמוד, והוא לא מופיע בתחתית האתר.
              </span>
            </span>
            <Switch
              checked={draft.is_published}
              onCheckedChange={(is_published) => patch({ is_published })}
              aria-label="מפורסם באתר"
            />
          </label>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="page-content">תוכן העמוד</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setHtmlMode((value) => !value)}
              >
                {htmlMode ? (
                  <Type className="size-4" aria-hidden="true" />
                ) : (
                  <Code2 className="size-4" aria-hidden="true" />
                )}
                {htmlMode ? "חזרה לעורך" : "עריכת HTML"}
              </Button>
            </div>
            {htmlMode ? (
              <Textarea
                id="page-content"
                dir="ltr"
                rows={14}
                value={draft.content_html}
                onChange={(event) => patch({ content_html: event.target.value })}
                className="font-mono text-xs"
              />
            ) : (
              <RichTextEditor
                id="page-content"
                value={draft.content_html}
                onChange={(content_html) => patch({ content_html })}
                ariaLabel="תוכן העמוד"
                minHeight={260}
              />
            )}
            <p className={cn("text-xs", redMarks > 0 ? "text-red-600" : "text-muted-foreground")}>
              {redMarks > 0
                ? `נשארו ${redMarks} מקומות באדום להשלמה — עדכנו אותם לפני הפרסום.`
                : "באתר מוצגים כותרות, הדגשות, רשימות וקישורים. תמונות וסקריפטים לא נשמרים."}
            </p>
            {richTextIsEmpty(draft.content_html) && (
              <p className="text-xs text-muted-foreground">העמוד עדיין ריק.</p>
            )}
          </div>

          {problem && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {problem}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void submit()} disabled={busy} data-testid="save-page">
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {isNew ? "יצירת העמוד" : "שמירה"}
          </Button>
          {!isNew && target && (
            <Button variant="outline" asChild>
              <a href={pagePath(target.draft.slug)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                צפייה באתר
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
