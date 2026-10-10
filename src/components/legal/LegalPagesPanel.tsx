import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  Scale,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { RichTextEditor } from "@/components/legal/RichTextEditor";
import { LegalVariablesBox } from "@/components/legal/LegalVariablesBox";
import { refreshSiteSettings, useSiteSettings } from "@/hooks/useSiteSettings";
import {
  DEFAULT_LEGAL_HTML,
  detailedLegalDraft,
  LEGAL_PAGES,
  LEGAL_RED_NOTE,
  legalContentOrDefault,
  legalVariablesFrom,
  type LegalPageKey,
} from "@/lib/legal-content";
import { countRedMarks, sanitizeRichHtml, toRichHtml } from "@/lib/rich-text";
import { saveLegalTexts, type LegalTexts } from "@/lib/site";

type Drafts = Record<LegalPageKey, string>;

/** השוואה אחרי ניקוי — אותו תוכן בכתיב HTML שונה לא נחשב "שינוי" */
const normalized = (html: string) => sanitizeRichHtml(toRichHtml(html)).trim();

/**
 * לשונית "עמודים משפטיים" (חלק 16א): עורך טקסט עשיר לתקנון, למדיניות
 * הפרטיות ולמדיניות הביטולים. נוסח ברירת המחדל הוא הערך ההתחלתי; המקומות
 * להשלמה מסומנים באדום — ובראש הלשונית הבקשה לעדכן אותם לפני פרסום החנות.
 */
export function LegalPagesPanel() {
  const { settings } = useSiteSettings();
  const router = useRouter();
  const [tab, setTab] = useState<LegalPageKey>("terms");
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [baseline, setBaseline] = useState<Drafts | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<{ key: LegalPageKey; html: string; label: string } | null>(
    null,
  );
  // חלק 37: סרגל הכלים של העורך נצמד מתחת לסרגל "שמירת העמודים" (שגם הוא צמוד)
  const sectionRef = useRef<HTMLElement>(null);
  const saveBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const section = sectionRef.current;
    const bar = saveBarRef.current;
    if (!section || !bar || typeof ResizeObserver === "undefined") return;
    const update = () =>
      section.style.setProperty("--editor-sticky-offset", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  });

  const savedOf = (from: typeof settings): Drafts => ({
    terms: legalContentOrDefault("terms", from?.terms_content),
    privacy: legalContentOrDefault("privacy", from?.privacy_content),
    cancellation: legalContentOrDefault("cancellation", from?.cancellation_policy_content),
  });

  // נטען פעם אחת — רענון מאוחר של ההגדרות לא דורס עריכה שלא נשמרה
  useEffect(() => {
    if (!settings || drafts) return;
    const initial = savedOf(settings);
    setDrafts(initial);
    setBaseline(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, drafts]);

  const notSavedYet: Record<LegalPageKey, boolean> = {
    terms: (settings?.terms_content ?? "").trim() === "",
    privacy: (settings?.privacy_content ?? "").trim() === "",
    cancellation: (settings?.cancellation_policy_content ?? "").trim() === "",
  };

  const dirtyKeys = useMemo(() => {
    if (!drafts || !baseline) return [] as LegalPageKey[];
    return LEGAL_PAGES.map((page) => page.key).filter(
      (key) => normalized(drafts[key]) !== normalized(baseline[key]),
    );
  }, [drafts, baseline]);

  if (!drafts || !baseline || !settings) {
    return <p className="text-sm text-muted-foreground">טוען את העמודים המשפטיים...</p>;
  }

  const anyUnsavedDefault = LEGAL_PAGES.some((page) => notSavedYet[page.key]);
  const canSave = dirtyKeys.length > 0 || anyUnsavedDefault;

  const save = async () => {
    setBusy(true);
    try {
      const texts: Partial<LegalTexts> = {};
      for (const page of LEGAL_PAGES) texts[page.column] = drafts[page.key];
      await saveLegalTexts(texts);
      const fresh = await refreshSiteSettings();
      const next = savedOf(fresh);
      setDrafts(next);
      setBaseline(next);
      await router.invalidate();
      toast.success("העמודים המשפטיים נשמרו ומוצגים באתר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const businessInfo = {
    businessName: settings.business_name,
    taxId: settings.business_tax_id,
    address: settings.business_address,
    phone: settings.support_phone || settings.business_phone,
    email: settings.business_email,
    sellsAlcohol: settings.sells_alcohol,
  };

  return (
    <section ref={sectionRef} className="space-y-5">
      <div
        ref={saveBarRef}
        className="sticky top-[var(--site-header-h,0px)] z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Scale className="size-5 text-primary" aria-hidden="true" />
            עמודים משפטיים
          </h2>
          <p className="text-sm text-muted-foreground">
            תקנון האתר, מדיניות הפרטיות ומדיניות הביטולים — מוצגים באתר ובקישורים בתחתית כל עמוד
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirtyKeys.length > 0 && (
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700"
              role="status"
            >
              <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
              שינויים שלא נשמרו
            </span>
          )}
          <Button disabled={busy || !canSave} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "שומר..." : "שמירת העמודים"}
          </Button>
        </div>
      </div>

      {/* ---------- הבקשה לעדכן את הטקסטים באדום ---------- */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-950 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-50"
      >
        <AlertTriangle
          className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-bold leading-6">{LEGAL_RED_NOTE}</p>
          <p className="text-sm leading-6 opacity-90">
            הנוסחים הם נקודת פתיחה כללית ואינם תחליף לייעוץ משפטי — מומלץ להעביר לבדיקת עו"ד. לסימון
            מקום להשלמה: מסמנים טקסט ולוחצים על{" "}
            <span className="font-bold text-red-600 dark:text-red-400">כפתור הסימון האדום</span>{" "}
            בסרגל; לחיצה נוספת מבטלת.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as LegalPageKey)} dir="rtl">
        <TabsList className="h-auto flex-wrap">
          {LEGAL_PAGES.map((page) => {
            const marks = countRedMarks(drafts[page.key]);
            return (
              <TabsTrigger key={page.key} value={page.key} className="gap-1.5">
                {page.title}
                {dirtyKeys.includes(page.key) && (
                  <span className="size-1.5 rounded-full bg-amber-500" aria-label="לא נשמר" />
                )}
                {marks > 0 && (
                  <span
                    className="numeric rounded-full bg-red-100 px-1.5 text-[11px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300"
                    title={`${marks} מקומות באדום להשלמה`}
                  >
                    {marks}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {LEGAL_PAGES.map((page) => {
          const marks = countRedMarks(drafts[page.key]);
          return (
            <TabsContent key={page.key} value={page.key} className="mt-4">
              <Card className="shadow-card">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="size-4 text-primary" aria-hidden="true" />
                        {page.title}
                      </CardTitle>
                      <CardDescription>
                        מוצג בעמוד{" "}
                        <a
                          href={page.path}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          dir="ltr"
                        >
                          {page.path}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                        {page.key === "cancellation" &&
                          " — מעל טופס ביטול העסקה שהלקוחות שולחים מהאתר"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {page.key !== "cancellation" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const key = page.key;
                            if (key === "cancellation") return;
                            setReplace({
                              key,
                              html: detailedLegalDraft(key, businessInfo),
                              label: "טיוטה מפורטת לפי פרטי העסק",
                            });
                          }}
                        >
                          <Wand2 className="size-4" />
                          טיוטה מפורטת
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setReplace({
                            key: page.key,
                            html: DEFAULT_LEGAL_HTML[page.key],
                            label: "נוסח ברירת המחדל",
                          })
                        }
                      >
                        <RotateCcw className="size-4" />
                        שחזור ברירת המחדל
                      </Button>
                    </div>
                  </div>
                  {notSavedYet[page.key] && (
                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      עוד לא נשמר נוסח משלכם — באתר מוצג כרגע נוסח ברירת המחדל שלמטה.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <RichTextEditor
                    id={`legal-${page.key}`}
                    ariaLabel={page.title}
                    autoGrow
                    value={drafts[page.key]}
                    onChange={(html) =>
                      setDrafts((current) => (current ? { ...current, [page.key]: html } : current))
                    }
                  />
                  <LegalVariablesBox
                    editorId={`legal-${page.key}`}
                    html={drafts[page.key]}
                    values={legalVariablesFrom(settings)}
                  />
                  <p
                    className={
                      marks > 0
                        ? "text-xs font-medium text-red-700 dark:text-red-300"
                        : "text-xs text-emerald-700 dark:text-emerald-300"
                    }
                    role="status"
                  >
                    {marks > 0
                      ? `נשארו ${marks} מקומות מסומנים באדום להשלמה`
                      : "אין מקומות מסומנים באדום — הנוסח מוכן לפרסום"}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      <AlertDialog open={replace !== null} onOpenChange={(open) => !open && setReplace(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>להחליף את הנוסח הנוכחי?</AlertDialogTitle>
            <AlertDialogDescription>
              הטקסט שבעורך יוחלף ב{replace?.label}. השינוי נכנס לתוקף באתר רק אחרי "שמירת העמודים".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => {
                if (!replace) return;
                setDrafts((current) =>
                  current ? { ...current, [replace.key]: replace.html } : current,
                );
                setReplace(null);
              }}
            >
              החלפה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
