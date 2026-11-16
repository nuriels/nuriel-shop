// "עיצוב האתר" (Stage 5b): עורך האתר של בעל העסק.
//   • מקטעים: סדר (גרירה או חצים), הסתרה, עריכת תוכן ותמונות, הוספה / מחיקה של מקטעים משלכם;
//   • עיצוב: ערכה (יוקרה / טבע / מודרני / רומנטי), צבעים וגופנים לכל ערכה, לוגו (D2);
//   • עריכה ישירה בתצוגה המקדימה (D2): לוחצים על טקסט ומקלידים; לחיצה על מקטע פותחת אותו כאן;
//   • פרסום: שינויים שלא פורסמו, פרסום, גרסאות קודמות ושחזור.
// כל שינוי מוצג מיד בתצוגה המקדימה (אותו רנדרר כמו האתר) ונשמר אוטומטית לטיוטה (revision —
// עריכה מקבילה ממקום אחר מזוהה). הגולשים רואים רק מה שפורסם.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  History,
  LockKeyhole,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@/platform/ui";
import {
  hospitalitySiteDraftSave,
  hospitalitySiteEditor,
  hospitalitySitePreview,
  hospitalitySitePublish,
  hospitalitySiteRestore,
  type SiteEditorView,
} from "../../api/site-editor.functions";
import type { PublicSite } from "../../types/website";
import {
  PREVIEW_DESIGN_MESSAGE,
  PREVIEW_EDIT_MESSAGE,
  PREVIEW_READY_MESSAGE,
  PREVIEW_RELOAD_MESSAGE,
  PREVIEW_SELECT_MESSAGE,
  isInlineField,
} from "../../website/design/preview";
import {
  MAX_CUSTOM_SECTIONS,
  defaultDesign,
  isCore,
  normalizeDesign,
  type CustomSectionType,
  type SiteDesign,
  type ThemeId,
} from "../../website/design/schema";
import { THEME_LIST, THEMES, themeColors } from "../../website/theme/themes";
import { errorText } from "../catalog/refresh";
import { formatDateTime } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { editorTab } from "../setup/model";
import { CalendarStyleField, FontField, LogoField } from "./BrandFields";
import { SectionFields } from "./SectionFields";
import { HeroMediaField } from "./HeroMediaField";
import { SeoPanel } from "./SeoFields";
import {
  CUSTOM_TYPES,
  SECTION_HINTS,
  SECTION_LABELS,
  addSection,
  customCount,
  moveSection,
  removeSection,
  toggleHidden,
  updateContent,
} from "./labels";

const KEY = [...manageKeys.all, "site-editor"] as const;
const SAVE_DELAY = 1200;

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export function WebsiteEditorPage() {
  const editor = useQuery({ queryKey: KEY, queryFn: () => hospitalitySiteEditor(), retry: false });
  const preview = useQuery({
    queryKey: [...KEY, "site"],
    queryFn: () => hospitalitySitePreview(),
    retry: false,
  });
  if (editor.isPending || preview.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">טוענים את העורך…</p>;
  if (editor.isError || preview.isError || !editor.data || !preview.data)
    return (
      <p role="alert" className="py-10 text-center text-sm text-destructive">
        {errorText(editor.error ?? preview.error)}
      </p>
    );
  const d = editor.data;
  // D2: אתר שעוד לא עוצב (ולא נבחרה לו ערכה בפתיחת העסק) — קודם בוחרים סגנון
  if (!d.draft && !d.published) return <ThemeWelcome />;
  const initial = normalizeDesign(
    d.draft?.document ?? d.published?.document ?? null,
    d.draft?.theme ?? d.published?.theme,
  );
  return (
    <Editor
      key={`${d.draft?.revision ?? 0}-${d.published?.version ?? 0}`}
      initial={initial}
      revision={d.draft?.revision ?? 0}
      view={d}
      site={preview.data}
    />
  );
}

function Editor({
  initial,
  revision: initialRevision,
  view,
  site,
}: {
  initial: SiteDesign;
  revision: number;
  view: SiteEditorView;
  site: PublicSite;
}) {
  const qc = useQueryClient();
  const [design, setDesign] = useState<SiteDesign>(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(view.draft?.updated_at ?? null);
  const revision = useRef(initialRevision);
  const pending = useRef<Promise<void> | null>(null);
  const first = useRef(true);

  // תצוגה מקדימה: העמוד והמכשיר
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [page, setPage] = useState<string>("home");
  const frame = useRef<HTMLIFrameElement>(null);
  const send = useCallback(
    (d: SiteDesign) =>
      frame.current?.contentWindow?.postMessage(
        { type: PREVIEW_DESIGN_MESSAGE, design: d },
        window.location.origin,
      ),
    [],
  );
  // הלשונית והמקטע הפתוח (לחיצה על מקטע בתצוגה המקדימה פותחת אותו כאן)
  // מדריך ההקמה מוביל ישר ללשונית (?tab=design / seo / publish)
  const linkedTab = editorTab((useSearch({ strict: false }) as Record<string, unknown>)["tab"]);
  const [tab, setTab] = useState<string>(linkedTab ?? "sections");
  const [openSection, setOpenSection] = useState<string | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: string; section?: unknown; field?: unknown; value?: unknown };
      if (data?.type === PREVIEW_READY_MESSAGE) send(design);
      // D2: טקסט שנערך בתצוגה המקדימה → אותו עדכון כמו מהשדות כאן (ואותה בדיקה)
      if (
        data?.type === PREVIEW_EDIT_MESSAGE &&
        typeof data.section === "string" &&
        isInlineField(data.field) &&
        typeof data.value === "string"
      ) {
        const { section, field, value } = data;
        setDesign((d) =>
          d.sections.some((x) => x.id === section)
            ? normalizeDesign(updateContent(d, section, { [field]: value.slice(0, 5000) }))
            : d,
        );
      }
      if (data?.type === PREVIEW_SELECT_MESSAGE && typeof data.section === "string") {
        setTab("sections");
        setOpenSection(data.section);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [design, send]);
  const reloadPreview = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [...KEY, "site"] });
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_RELOAD_MESSAGE },
      window.location.origin,
    );
  }, [qc]);
  useEffect(() => send(design), [design, send]);

  // שמירה אוטומטית לטיוטה
  const save = useCallback(async (d: SiteDesign) => {
    setState("saving");
    try {
      const r = await hospitalitySiteDraftSave({
        data: { revision: revision.current, document: JSON.stringify(d) },
      });
      revision.current = r.revision;
      setSavedAt(r.updated_at);
      setState("saved");
    } catch (e) {
      setState(e instanceof Error && e.message.includes("ממקום אחר") ? "conflict" : "error");
    }
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (state === "conflict") return;
    setState("dirty");
    const timer = setTimeout(() => {
      pending.current = save(design);
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design]);

  const flush = async () => {
    if (state === "dirty" || state === "error") await save(design);
    else if (pending.current) await pending.current;
  };

  const reload = () => void qc.invalidateQueries({ queryKey: KEY });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">עיצוב האתר</h1>
          <p className="text-sm text-muted-foreground">
            השינויים נשמרים אוטומטית כטיוטה. הגולשים רואים רק מה שפרסמתם.
          </p>
        </div>
        <SaveBadge state={state} savedAt={savedAt} onReload={reload} />
      </header>

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg border bg-card">
          <Tabs value={tab} onValueChange={setTab} dir="rtl">
            <TabsList className="m-2 grid h-auto grid-cols-4">
              <TabsTrigger value="sections" className="min-h-9">
                מקטעים
              </TabsTrigger>
              <TabsTrigger value="design" className="min-h-9">
                עיצוב
              </TabsTrigger>
              <TabsTrigger value="seo" className="min-h-9 px-1">
                גוגל ושיתוף
              </TabsTrigger>
              <TabsTrigger value="publish" className="min-h-9">
                פרסום
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sections" className="p-3 pt-0">
              <SectionsPanel
                design={design}
                site={site}
                onChange={setDesign}
                open={openSection}
                setOpen={setOpenSection}
                onMediaAdded={reloadPreview}
              />
            </TabsContent>
            <TabsContent value="design" className="p-3 pt-0">
              <DesignPanel
                design={design}
                site={site}
                onChange={setDesign}
                onMediaAdded={reloadPreview}
              />
            </TabsContent>
            <TabsContent value="seo" className="p-3 pt-0">
              <SeoPanel
                design={design}
                site={site}
                addresses={view.addresses}
                onChange={setDesign}
              />
            </TabsContent>
            <TabsContent value="publish" className="p-3 pt-0">
              <PublishPanel
                view={view}
                unsaved={state !== "saved"}
                flush={flush}
                revision={() => revision.current}
                onDone={reload}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label="גודל התצוגה">
              <Button
                type="button"
                size="sm"
                variant={device === "desktop" ? "default" : "outline"}
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
                className="min-h-10 gap-1.5"
              >
                <Monitor className="size-4" aria-hidden="true" />
                מחשב
              </Button>
              <Button
                type="button"
                size="sm"
                variant={device === "mobile" ? "default" : "outline"}
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
                className="min-h-10 gap-1.5"
              >
                <Smartphone className="size-4" aria-hidden="true" />
                נייד
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">עמוד:</span>
              <select
                value={page}
                onChange={(e) => setPage(e.target.value)}
                className="min-h-10 rounded-md border bg-background px-2"
              >
                <option value="home">עמוד הבית</option>
                {site.units.map((u) => (
                  <option key={u.id} value={u.slug}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PreviewFrame
            frameRef={frame}
            device={device}
            src={
              page === "home"
                ? "/manage/preview"
                : `/manage/preview?page=unit&unit=${encodeURIComponent(page)}`
            }
          />
        </div>
      </div>
    </div>
  );
}

/** בחירת הסגנון הראשונה (D2): ערכה → טיוטה ראשונה עם כל המקטעים, ומשם העורך הרגיל */
function ThemeWelcome() {
  const qc = useQueryClient();
  const pick = useMutation({
    mutationFn: (theme: ThemeId) =>
      hospitalitySiteDraftSave({
        data: { revision: 0, document: JSON.stringify(defaultDesign(theme)) },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">איזה סגנון מתאים לעסק שלכם?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          בוחרים ערכה להתחלה — התוכן, התמונות והמחירים כבר מגיעים מנתוני העסק. אפשר להחליף ערכה,
          צבעים וגופנים בכל זמן, בלי לאבד כלום.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {THEME_LIST.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={pick.isPending}
            onClick={() => pick.mutate(t.id)}
            className="flex flex-col overflow-hidden rounded-lg border text-start ring-offset-2 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            <span
              className="flex h-28"
              style={{ background: t.palette.background }}
              aria-hidden="true"
            >
              <span className="m-3 flex-1 rounded" style={{ background: t.palette.sand }} />
              <span className="my-3 w-10" style={{ background: t.palette.primary }} />
              <span
                className="m-3 ms-2 w-6 rounded-full"
                style={{ background: t.palette.accent }}
              />
            </span>
            <span className="flex flex-col gap-1 p-4">
              <span className="text-lg font-semibold">{t.label}</span>
              <span className="text-sm text-muted-foreground">{t.description}</span>
              <span className="text-xs text-muted-foreground">מתאים ל: {t.suits.join(", ")}</span>
            </span>
          </button>
        ))}
      </div>
      {pick.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          מכינים את האתר…
        </p>
      )}
    </div>
  );
}

/** מחשב: האתר ברוחב 1280 אמיתי, מוקטן לרוחב החלון; נייד: 390 בגודל מלא */
const DESKTOP_WIDTH = 1280;
const FRAME_HEIGHT = 720;

function PreviewFrame({
  frameRef,
  device,
  src,
}: {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  device: "desktop" | "mobile";
  src: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = device === "desktop" && width ? Math.min(1, width / DESKTOP_WIDTH) : 1;
  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-lg border bg-muted/40"
      style={{ height: FRAME_HEIGHT }}
    >
      <iframe
        ref={frameRef}
        title="תצוגה מקדימה של האתר"
        src={src}
        style={
          device === "desktop"
            ? {
                width: DESKTOP_WIDTH,
                height: FRAME_HEIGHT / scale,
                transform: `scale(${scale})`,
                transformOrigin: "top right",
              }
            : { width: 390, height: FRAME_HEIGHT }
        }
        className={cn(
          "absolute top-0 block bg-white",
          device === "desktop" ? "right-0" : "right-1/2 max-w-full translate-x-1/2",
        )}
      />
    </div>
  );
}

function SaveBadge({
  state,
  savedAt,
  onReload,
}: {
  state: SaveState;
  savedAt: string | null;
  onReload: () => void;
}) {
  if (state === "conflict")
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <TriangleAlert className="size-4" aria-hidden="true" />
        העיצוב השתנה ממקום אחר.
        <Button type="button" size="sm" variant="outline" onClick={onReload}>
          טעינה מחדש
        </Button>
      </div>
    );
  const text =
    state === "saving"
      ? "שומרים…"
      : state === "dirty"
        ? "יש שינויים — נשמרים בעוד רגע"
        : state === "error"
          ? "השמירה נכשלה — ננסה שוב בשינוי הבא"
          : savedAt
            ? `נשמר כטיוטה · ${formatDateTime(savedAt)}`
            : "אין שינויים";
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 text-sm",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saved" && <Check className="size-4 text-emerald-700" aria-hidden="true" />}
      {text}
    </p>
  );
}

// ---------- מקטעים ----------

function SectionsPanel({
  design,
  site,
  onChange,
  open,
  setOpen,
  onMediaAdded,
}: {
  design: SiteDesign;
  site: PublicSite;
  onChange: (d: SiteDesign) => void;
  open: string | null;
  setOpen: (id: string | null) => void;
  onMediaAdded: () => void;
}) {
  // מקטע שנפתח מהתצוגה המקדימה — גלילה אליו ברשימה
  useEffect(() => {
    if (open) document.getElementById(`section-item-${open}`)?.scrollIntoView({ block: "nearest" });
  }, [open]);
  const [drag, setDrag] = useState<string | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const count = customCount(design);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        גוררים (או בחצים) כדי לשנות את הסדר; העין מסתירה מקטע בלי למחוק אותו. אפשר גם ללחוץ על כותרת
        או טקסט בתצוגה המקדימה ולערוך אותם שם ישירות.
      </p>
      <ol className="flex flex-col gap-2" aria-label="מקטעי עמוד הבית">
        {design.sections.map((s, i) => (
          <li
            key={s.id}
            id={`section-item-${s.id}`}
            draggable
            onDragStart={() => setDrag(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag && drag !== s.id) onChange(moveSection(design, drag, i));
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={cn(
              "scroll-mt-2 rounded-md border bg-background",
              drag === s.id && "opacity-50",
              s.hidden && "bg-muted/50",
              open === s.id && "ring-2 ring-primary/40",
            )}
          >
            <div className="flex items-center gap-1 p-1.5">
              <GripVertical
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => setOpen(open === s.id ? null : s.id)}
                aria-expanded={open === s.id}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded px-1 text-start text-sm"
              >
                <span
                  className={cn(
                    "truncate font-medium",
                    s.hidden && "text-muted-foreground line-through",
                  )}
                >
                  {SECTION_LABELS[s.type]}
                  {s.content.title && !isCore(s.type) ? ` — ${s.content.title}` : ""}
                </span>
                <ChevronDown
                  className={cn(
                    "ms-auto size-4 shrink-0 transition-transform",
                    open === s.id && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              <IconButton
                label={`הזזה למעלה: ${SECTION_LABELS[s.type]}`}
                disabled={i === 0}
                onClick={() => onChange(moveSection(design, s.id, i - 1))}
              >
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton
                label={`הזזה למטה: ${SECTION_LABELS[s.type]}`}
                disabled={i === design.sections.length - 1}
                onClick={() => onChange(moveSection(design, s.id, i + 1))}
              >
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton
                label={
                  s.hidden ? `הצגה: ${SECTION_LABELS[s.type]}` : `הסתרה: ${SECTION_LABELS[s.type]}`
                }
                pressed={!s.hidden}
                onClick={() => onChange(toggleHidden(design, s.id))}
              >
                {s.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </IconButton>
            </div>
            {open === s.id && (
              <div className="border-t p-3">
                <p className="mb-3 text-xs text-muted-foreground">{SECTION_HINTS[s.type]}</p>
                <SectionFields
                  section={s}
                  site={site}
                  logo={design.logo}
                  onChange={(patch) => onChange(updateContent(design, s.id, patch))}
                  onMediaAdded={onMediaAdded}
                />
                {!isCore(s.type) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-4 gap-1.5 text-destructive"
                    onClick={() => setRemove(s.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    מחיקת המקטע
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="rounded-md border border-dashed p-3">
        <p className="mb-2 text-sm font-medium">הוספת מקטע</p>
        {count >= MAX_CUSTOM_SECTIONS ? (
          <p className="text-xs text-muted-foreground">
            הגעתם למספר המקטעים הנוספים ({MAX_CUSTOM_SECTIONS}).
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {CUSTOM_TYPES.map((type: CustomSectionType) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                className="h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-start"
                onClick={() => {
                  const next = addSection(design, type, open ?? undefined);
                  onChange(next);
                  const added = next.sections.find(
                    (x) => !design.sections.some((y) => y.id === x.id),
                  );
                  if (added) setOpen(added.id);
                }}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <Plus className="size-3.5" aria-hidden="true" />
                  {SECTION_LABELS[type]}
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {SECTION_HINTS[type]}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
      <AlertDialog open={remove !== null} onOpenChange={(o) => !o && setRemove(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את המקטע?</AlertDialogTitle>
            <AlertDialogDescription>
              התוכן שלו יימחק מהטיוטה. אפשר גם רק להסתיר אותו (העין).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (remove) onChange(removeSection(design, remove));
                setRemove(null);
                setOpen(null);
              }}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ---------- עיצוב ----------

function DesignPanel({
  design,
  site,
  onChange,
  onMediaAdded,
}: {
  design: SiteDesign;
  site: PublicSite;
  onChange: (d: SiteDesign) => void;
  onMediaAdded: () => void;
}) {
  // התמונה הראשית והסרטון — התוכן של מקטע הפתיח (אותו ערך כמו בלשונית "מקטעים")
  const hero = design.sections.find((x) => x.type === "hero");
  const theme = THEMES[design.theme];
  const overrides = useMemo(() => design.colors[design.theme] ?? {}, [design.colors, design.theme]);
  const effective = useMemo(() => themeColors(theme, overrides), [theme, overrides]);
  const setColor = (key: "primary" | "accent", value: string | undefined) => {
    const next = { ...overrides, [key]: value };
    if (!value) delete next[key];
    const colors = { ...design.colors, [design.theme]: next };
    if (!next.primary && !next.accent) delete colors[design.theme];
    onChange({ ...design, colors });
  };
  return (
    <div className="flex flex-col gap-5">
      <LogoField design={design} site={site} onChange={onChange} onMediaAdded={onMediaAdded} />
      {hero && (
        <HeroMediaField
          site={site}
          image={hero.content.image}
          video={hero.content.video}
          logo={design.logo}
          onChange={(patch) => onChange(updateContent(design, hero.id, patch))}
          onMediaAdded={onMediaAdded}
        />
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">ערכת עיצוב</legend>
        <p className="mb-3 text-xs text-muted-foreground">
          החלפת ערכה לא משנה את התוכן, את סדר המקטעים או את התמונות. הצבעים שבחרתם נשמרים לכל ערכה.
        </p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ערכת עיצוב">
          {THEME_LIST.map((t) => {
            const c = themeColors(t, design.colors[t.id]);
            const selected = design.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...design, theme: t.id })}
                className={cn(
                  "flex flex-col overflow-hidden rounded-md border-2 text-start",
                  selected
                    ? "border-primary"
                    : "border-transparent ring-1 ring-border hover:ring-foreground/30",
                )}
              >
                <span className="flex h-14" style={{ background: c.background }} aria-hidden="true">
                  <span className="m-2 flex-1 rounded-sm" style={{ background: t.palette.sand }} />
                  <span className="my-2 w-6" style={{ background: c.primary }} />
                  <span className="m-2 ms-1 w-4 rounded-full" style={{ background: c.accent }} />
                </span>
                <span className="px-2 py-1.5">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {selected && <Check className="size-3.5" aria-hidden="true" />}
                    {t.label}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {t.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          מתאים במיוחד ל: {theme.suits.join(", ")}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">צבעים — {theme.label}</legend>
        <ColorRow
          label="צבע ראשי (כפתורים)"
          value={overrides.primary ?? theme.palette.primary}
          custom={!!overrides.primary}
          onChange={(v) => setColor("primary", v)}
        />
        <ColorRow
          label="צבע הדגשה"
          value={overrides.accent ?? theme.palette.accent}
          custom={!!overrides.accent}
          onChange={(v) => setColor("accent", v)}
        />
        {(effective.accentInk.toLowerCase() !== effective.accent.toLowerCase() ||
          (overrides.primary && effective.primaryForeground !== "#ffffff")) && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            כדי שהטקסט יישאר קריא, הטקסט הקטן בצבע ההדגשה מוצג בגוון כהה יותר, והטקסט על הכפתורים
            בצבע הקריא ביותר.
          </p>
        )}
      </fieldset>

      <FontField design={design} onChange={onChange} />
      <CalendarStyleField design={design} onChange={onChange} />

      {/* F1: הקרדיט בתחתית האתר — חלק מהפלטפורמה, לא מהעיצוב */}
      <div
        className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground"
        data-credit-note=""
      >
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-medium text-foreground">קרדיט הפלטפורמה בתחתית האתר</span> — "האתר
          נבנה באמצעות Nuriel Hospitality מבית נוריאל מחשבים". הוא מופיע בכל הערכות ובכל העמודים,
          קבוע ולא ניתן להסרה. הזכויות על התמונות והתוכן שלכם נשארות שלכם.
        </p>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  custom,
  onChange,
}: {
  label: string;
  value: string;
  custom: boolean;
  onChange: (v: string | undefined) => void;
}) {
  const id = `color-${label}`;
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-10 w-12 cursor-pointer rounded border bg-transparent"
      />
      <Label htmlFor={id} className="flex-1">
        {label}
        <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
          {value}
        </span>
      </Label>
      {custom && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          ברירת המחדל
        </Button>
      )}
    </div>
  );
}

// ---------- פרסום ----------

function PublishPanel({
  view,
  unsaved,
  flush,
  revision,
  onDone,
}: {
  view: SiteEditorView;
  unsaved: boolean;
  flush: () => Promise<void>;
  revision: () => number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [restore, setRestore] = useState<number | null>(null);
  const publish = useMutation({
    mutationFn: async () => {
      await flush();
      return hospitalitySitePublish({ data: { revision: revision(), note: note.trim() || null } });
    },
    onSuccess: (r) => {
      toast.success(
        view.opens_on_publish
          ? `האתר פורסם (גרסה ${r.version}) ונפתח לגולשים`
          : `האתר פורסם (גרסה ${r.version})`,
      );
      setNote("");
      onDone();
      // מיגרציה 40: הפרסום פתח את האתר — מצב האתר בכל אזור הניהול (לוח הבקרה, מדריך ההקמה)
      if (view.opens_on_publish) void qc.invalidateQueries({ queryKey: manageKeys.all });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const restoreMut = useMutation({
    mutationFn: (version: number) => hospitalitySiteRestore({ data: { version } }),
    onSuccess: () => {
      toast.success("הגרסה נטענה לטיוטה — אפשר לבדוק ולפרסם");
      setRestore(null);
      onDone();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const pendingChanges = view.unpublished || unsaved || (!view.published && !view.draft);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border p-3 text-sm">
        {view.published ? (
          <p>
            גרסה מפורסמת: <strong>{view.published.version}</strong> ·{" "}
            {formatDateTime(view.published.published_at)}
          </p>
        ) : (
          <p>עוד לא פרסמתם עיצוב — האתר מוצג בעיצוב ההתחלתי.</p>
        )}
        <p className={cn("mt-1", pendingChanges ? "text-amber-800" : "text-muted-foreground")}>
          {pendingChanges ? "יש שינויים שעוד לא פורסמו." : "כל השינויים פורסמו."}
        </p>
        {!view.site_open && (
          <p className="mt-1 text-xs text-muted-foreground">
            {view.opens_on_publish
              ? "האתר ייפתח לגולשים ולהזמנות ברגע שתפרסמו."
              : "האתר עדיין סגור לגולשים — הפרסום יוצג כשהאתר ייפתח."}
          </p>
        )}
        {view.site_open && (
          <a
            href="/stay"
            target="_blank"
            rel="noopener"
            className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            לאתר
          </a>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="publish-note">הערה לגרסה (לא חובה)</Label>
        <Input
          id="publish-note"
          value={note}
          maxLength={120}
          placeholder="למשל: תמונות קיץ"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button
        type="button"
        className="min-h-11"
        disabled={publish.isPending}
        onClick={() => publish.mutate()}
      >
        {publish.isPending ? "מפרסמים…" : "פרסום האתר"}
      </Button>

      <section aria-labelledby="versions-title">
        <h2 id="versions-title" className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <History className="size-4" aria-hidden="true" />
          גרסאות קודמות
        </h2>
        {view.versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">עוד אין גרסאות.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {view.versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-2 p-2">
                <span className="min-w-0">
                  <span className="font-medium">גרסה {v.version}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {THEMES[v.theme as keyof typeof THEMES]?.label ?? v.theme}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(v.published_at)}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRestore(v.version)}
                >
                  שחזור
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AlertDialog open={restore !== null} onOpenChange={(o) => !o && setRestore(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לטעון את גרסה {restore} לטיוטה?</AlertDialogTitle>
            <AlertDialogDescription>
              הטיוטה הנוכחית תוחלף בגרסה הזו. האתר לא משתנה עד שתפרסמו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => restore && restoreMut.mutate(restore)}>
              שחזור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
