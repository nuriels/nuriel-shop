// עורך האתר — לוגו וגופנים (D2).
//   • לוגו: העלאה — נשמר בנפרד מהתמונות ("brand", מיגרציה 42): לא ב"תמונות", לא בגלריה ולא
//     נהיה תמונה ראשית (אותו מנגנון בדיקה וקידוד כמו כל תמונה; שקיפות נשמרת); או בחירה מהלוגואים
//     שהועלו / מהתמונות הקיימות. אפשר להציג גם את שם העסק לידו. הלוגו לא משמש כתמונת הפתיח;
//   • גופנים: זוג מאושר לכל ערכה (כמו הצבעים) — בלי בחירה, הגופנים של הערכה.
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { hospitalityUploadMedia } from "../../api/media.functions";
import type { PublicSite } from "../../types/website";
import { CALENDAR_STYLES, type CalendarStyle, type SiteDesign } from "../../website/design/schema";
import { mediaById } from "../../website/lib/media";
import { FONT_PAIR_LIST, fontHref } from "../../website/theme/fonts";
import { THEMES } from "../../website/theme/themes";
import { errorText } from "../catalog/refresh";
import { ImagePicker } from "./SectionFields";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export function LogoField({
  design,
  site,
  onChange,
  onMediaAdded,
}: {
  design: SiteDesign;
  site: PublicSite;
  onChange: (d: SiteDesign) => void;
  /** אחרי העלאה — נתוני האתר בעורך ובתצוגה המקדימה מחדש */
  onMediaAdded: () => void;
}) {
  const logo = mediaById(site, design.logo);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const setLogo = (id: string | undefined) => {
    const next: SiteDesign = { ...design };
    if (id) next.logo = id;
    else {
      delete next.logo;
      delete next.logoName;
    }
    onChange(next);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("הלוגו צריך להיות קובץ PNG, JPG או WebP (PNG שקוף — הכי מומלץ)");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("הקובץ גדול מדי — עד 5MB");
      return;
    }
    setBusy(true);
    try {
      const before = new Set((site.brand ?? []).map((m) => m.id));
      const fd = new FormData();
      fd.set("ownerKind", "brand");
      fd.set("alt", `הלוגו של ${site.business.name}`.slice(0, 200));
      fd.set("file", file, file.name);
      const gallery = await hospitalityUploadMedia({ data: fd });
      const added = gallery.items
        .filter((m) => m.kind === "image" && !before.has(m.id))
        .sort((a, b) => b.sort_order - a.sort_order)[0];
      if (added) setLogo(added.id);
      onMediaAdded();
      toast.success("הלוגו הועלה");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">לוגו</legend>
      <div className="flex items-center gap-3">
        <div
          className="flex h-16 w-32 shrink-0 items-center justify-center rounded-md border bg-[repeating-conic-gradient(#f1f1f1_0_25%,#fff_0_50%)] bg-[length:12px_12px] p-1.5"
          aria-hidden={!logo}
        >
          {logo?.url ? (
            <img
              src={logo.url}
              alt="הלוגו הנוכחי"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="px-1 text-center text-[11px] text-muted-foreground">
              בלי לוגו — שם העסק בטקסט
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            id="logo-upload"
            // הכפתור שמתחת הוא הפקד הנגיש; השדה עצמו מחוץ לסדר המקלדת ולקורא המסך
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-10 gap-1.5"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {busy ? "מעלה…" : logo ? "החלפת לוגו" : "העלאת לוגו"}
          </Button>
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            בחירה מהלוגואים שהועלו או מהתמונות
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {picking && (
        <ImagePicker
          site={site}
          value={design.logo}
          label="בחירת הלוגו"
          extra={site.brand ?? []}
          clearLabel="בלי לוגו (שם העסק בטקסט)"
          onChange={(id: string | undefined) => setLogo(id)}
        />
      )}
      {logo && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={design.logoName === true}
              onChange={(e) => {
                const next = { ...design };
                if (e.target.checked) next.logoName = true;
                else delete next.logoName;
                onChange(next);
              }}
            />
            להציג גם את שם העסק ליד הלוגו
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-10 gap-1.5 self-start text-muted-foreground"
            onClick={() => setLogo(undefined)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            הסרת הלוגו מהאתר
          </Button>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        מומלץ PNG עם רקע שקוף, ברוחב 400 פיקסלים לפחות. הלוגו מוצג בראש כל עמוד; הוא לא נכנס לגלריה
        ולא מחליף את התמונה הראשית.
      </p>
    </fieldset>
  );
}

export function FontField({
  design,
  onChange,
}: {
  design: SiteDesign;
  onChange: (d: SiteDesign) => void;
}) {
  const theme = THEMES[design.theme];
  const current = design.fonts?.[design.theme];
  const set = (id: (typeof FONT_PAIR_LIST)[number]["id"] | undefined) => {
    const fonts = { ...design.fonts };
    if (id) fonts[design.theme] = id;
    else delete fonts[design.theme];
    const next: SiteDesign = { ...design, fonts };
    if (Object.keys(fonts).length === 0) delete next.fonts;
    onChange(next);
  };
  const options = [
    { id: undefined, label: "של הערכה", description: "הגופנים המקוריים של הערכה" },
    ...FONT_PAIR_LIST,
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">גופנים — {theme.label}</legend>
      {/* הדוגמאות בגופנים עצמם (רק בעורך) */}
      {FONT_PAIR_LIST.map((f) => {
        const href = fontHref(f.id);
        return href ? <link key={f.id} rel="stylesheet" href={href} precedence="default" /> : null;
      })}
      <div className="grid gap-1.5" role="radiogroup" aria-label={`גופנים — ${theme.label}`}>
        {options.map((o) => {
          const selected = current === o.id;
          const pair = o.id ? FONT_PAIR_LIST.find((f) => f.id === o.id) : undefined;
          const display = pair?.display ?? theme.vars["--site-display-font"];
          const body = pair?.body ?? '"Heebo", sans-serif';
          return (
            <button
              key={o.id ?? "theme"}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => set(o.id)}
              className={cn(
                "flex flex-col rounded-md border-2 px-3 py-2 text-start",
                selected
                  ? "border-primary"
                  : "border-transparent ring-1 ring-border hover:ring-foreground/30",
              )}
            >
              <span className="text-xs text-muted-foreground">{o.label}</span>
              <span
                className="truncate text-lg leading-snug"
                style={{ fontFamily: display, fontWeight: pair?.displayWeight }}
              >
                חופשה שקטה בגליל
              </span>
              <span className="truncate text-xs text-muted-foreground" style={{ fontFamily: body }}>
                {o.description}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        כל הגופנים כוללים עברית מלאה ונבדקו לקריאות. הבחירה נשמרת לכל ערכה בנפרד.
      </p>
    </fieldset>
  );
}

const CALENDAR_LABELS: Record<CalendarStyle, { label: string; description: string }> = {
  classic: { label: "קלאסי", description: "נקי ושקט — תפוס מסומן בקו, לא פתוח בפסים" },
  colors: { label: "צבעוני", description: "פנוי בירוק, תפוס באדום, לא פתוח באפור — ברור במבט אחד" },
  minimal: { label: "מינימלי", description: "מספרים בלבד, ונקודה צבעונית מתחת לכל יום" },
};

/** K3: הסגנון של לוח השנה באתר (בחירת תאריכים) — שלוש אפשרויות, עם דוגמה קטנה */
export function CalendarStyleField({
  design,
  onChange,
}: {
  design: SiteDesign;
  onChange: (d: SiteDesign) => void;
}) {
  const current: CalendarStyle = design.calendar ?? "classic";
  const set = (s: CalendarStyle) => {
    const next: SiteDesign = { ...design };
    if (s === "classic") delete next.calendar;
    else next.calendar = s;
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">לוח השנה באתר</legend>
      <div className="grid gap-1.5" role="radiogroup" aria-label="לוח השנה באתר">
        {CALENDAR_STYLES.map((s) => {
          const selected = current === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => set(s)}
              data-calendar-option={s}
              className={cn(
                "flex items-center gap-3 rounded-md border-2 px-3 py-2 text-start",
                selected
                  ? "border-primary"
                  : "border-transparent ring-1 ring-border hover:ring-foreground/30",
              )}
            >
              <CalendarSample look={s} />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{CALENDAR_LABELS[s].label}</span>
                <span className="text-xs text-muted-foreground">
                  {CALENDAR_LABELS[s].description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        כך האורחים רואים אילו תאריכים פנויים, תפוסים או עוד לא נפתחו להזמנה.
      </p>
    </fieldset>
  );
}

/** דוגמה קטנה: פנוי, תפוס, לא פתוח */
function CalendarSample({ look }: { look: CalendarStyle }) {
  const cell = "relative flex size-6 items-center justify-center rounded-full text-[10px]";
  const kinds = {
    classic: [
      "ring-1 ring-foreground/30",
      "text-muted-foreground line-through",
      "text-muted-foreground/60 bg-slate-100",
    ],
    colors: [
      "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200",
      "bg-rose-50 text-rose-900 line-through",
      "bg-slate-100 text-slate-500",
    ],
    minimal: ["", "text-muted-foreground", "text-muted-foreground/40"],
  }[look];
  return (
    <span className="flex shrink-0 gap-1" aria-hidden="true">
      {kinds.map((k, i) => (
        <span key={i} className={cn(cell, k)}>
          {i + 7}
          {look === "minimal" && i < 2 && (
            <span
              className={cn(
                "absolute bottom-0.5 size-1 rounded-full",
                i === 0 ? "bg-emerald-600" : "bg-rose-600",
              )}
            />
          )}
        </span>
      ))}
    </span>
  );
}
