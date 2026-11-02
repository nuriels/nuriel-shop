// השדות של כל מקטע בעורך. שדה ריק = ברירת המחדל (מוצגת כ-placeholder) מנתוני העסק.
// תמונות — רק מתמונות האתר / המתחמים / היחידות (העלאה: "תמונות" באזור הניהול).
import { Plus, Trash2 } from "lucide-react";
import { Input, Label, Switch, Textarea, cn } from "@/platform/ui";
import type { PublicMedia, PublicSite } from "../../types/website";
import { AMENITY_ICONS } from "../../validation/details";
import {
  LIMITS,
  MAX_FAQ,
  MAX_GALLERY_PICK,
  MAX_HIGHLIGHTS,
  type Section,
  type SectionContent,
} from "../../website/design/schema";
import { firstSentence } from "../../website/lib/format";
import { allMedia } from "../../website/lib/media";
import { AmenityIcon } from "../details/AmenityIcon";

/** שדה ריק / undefined = חזרה לברירת המחדל */
export type ContentPatch = { [K in keyof SectionContent]?: SectionContent[K] | undefined };
type Patch = (p: ContentPatch) => void;

export function SectionFields({
  section,
  site,
  onChange,
}: {
  section: Section;
  site: PublicSite;
  onChange: Patch;
}) {
  const c = section.content;
  const prop = site.properties[0];
  const text = (key: "eyebrow" | "title" | "subtitle", label: string, placeholder?: string) => (
    <Field id={`${section.id}-${key}`} label={label}>
      <Input
        id={`${section.id}-${key}`}
        value={c[key] ?? ""}
        maxLength={LIMITS[key]}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </Field>
  );
  const body = (label: string, placeholder?: string, rows = 6) => (
    <Field id={`${section.id}-body`} label={label}>
      <Textarea
        id={`${section.id}-body`}
        value={c.body ?? ""}
        rows={rows}
        maxLength={LIMITS.body}
        placeholder={placeholder}
        onChange={(e) => onChange({ body: e.target.value })}
      />
    </Field>
  );

  switch (section.type) {
    case "hero":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת", "סוג המקום והאזור")}
          {text("title", "כותרת", site.business.name)}
          {text("subtitle", "משפט פתיחה", prop?.description ? firstSentence(prop.description) : "")}
          <Field id={`${section.id}-button`} label="טקסט הכפתור">
            <Input
              id={`${section.id}-button`}
              value={c.button ?? ""}
              maxLength={LIMITS.button}
              placeholder="בדיקת זמינות והזמנה"
              onChange={(e) => onChange({ button: e.target.value })}
            />
          </Field>
          <ImagePicker
            site={site}
            value={c.image}
            onChange={(image) => onChange({ image })}
            label="תמונת הפתיח"
          />
          <Choice
            label="הכהיית התמונה (לקריאות הטקסט)"
            value={c.overlay ?? "medium"}
            options={[
              ["light", "קלה"],
              ["medium", "רגילה"],
              ["strong", "חזקה"],
            ]}
            onChange={(v) => onChange({ overlay: v as SectionContent["overlay"] })}
          />
        </Stack>
      );
    case "about":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת", "על המקום")}
          {text("title", "כותרת", prop?.name ?? site.business.name)}
          {body("טקסט", prop?.description ?? "התיאור מהמתחם (יחידות ← המתחם)")}
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Switch
              checked={c.facts !== false}
              onCheckedChange={(v) => onChange({ facts: v ? undefined : false })}
            />
            להציג עובדות מהירות (כניסה, יציאה, אורחים, "החל מ-")
          </label>
        </Stack>
      );
    case "units":
    case "amenities":
    case "terms":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת")}
          {text("title", "כותרת")}
          {text("subtitle", "תת-כותרת")}
          <p className="text-xs text-muted-foreground">
            התוכן עצמו מגיע מנתוני העסק ומתעדכן לבד (יחידות, מתקנים, מדיניות וכללי המקום).
          </p>
        </Stack>
      );
    case "gallery":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת", "גלריה")}
          {text("title", "כותרת", "רגעים מהמקום")}
          {text("subtitle", "תת-כותרת")}
          <ImagePicker
            site={site}
            multiple
            value={c.images}
            onChange={(images) => onChange({ images })}
            label={`התמונות בגלריה (לא בחרתם — כל התמונות; עד ${MAX_GALLERY_PICK})`}
          />
        </Stack>
      );
    case "location":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת", "המיקום")}
          {text("title", "כותרת המיקום", "איך מגיעים")}
          {text("subtitle", "כותרת יצירת הקשר", "נשמח לעמוד לשירותכם")}
          <Field id={`${section.id}-note`} label="הערה מתחת לכתובת">
            <Input
              id={`${section.id}-note`}
              value={c.note ?? ""}
              maxLength={LIMITS.note}
              placeholder="הכתובת המדויקת והוראות ההגעה נשלחות לאורחים לפני ההגעה."
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </Field>
        </Stack>
      );
    case "text":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת")}
          {text("title", "כותרת")}
          {body("טקסט")}
          <ImagePicker
            site={site}
            value={c.image}
            onChange={(image) => onChange({ image })}
            label="תמונה (לא חובה)"
          />
          {c.image && (
            <Choice
              label="מיקום התמונה"
              value={c.imageSide ?? "end"}
              options={[
                ["end", "בצד שמאל"],
                ["start", "בצד ימין"],
              ]}
              onChange={(v) => onChange({ imageSide: v as SectionContent["imageSide"] })}
            />
          )}
        </Stack>
      );
    case "highlights":
      return (
        <Stack>
          {text("eyebrow", "שורה מעל הכותרת")}
          {text("title", "כותרת")}
          <Items
            items={c.items ?? []}
            max={MAX_HIGHLIGHTS}
            addLabel="הוספת נקודה"
            empty={{ icon: "star", title: "", text: null }}
            onChange={(items) => onChange({ items })}
            render={(item, set, n) => (
              <>
                <div
                  className="flex flex-wrap gap-1"
                  role="radiogroup"
                  aria-label={`אייקון לנקודה ${n + 1}`}
                >
                  {AMENITY_ICONS.slice(0, 24).map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      role="radio"
                      aria-checked={item.icon === icon}
                      aria-label={icon}
                      onClick={() => set({ ...item, icon })}
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-md border",
                        item.icon === icon
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:bg-muted",
                      )}
                    >
                      <AmenityIcon name={icon} className="size-4" />
                    </button>
                  ))}
                </div>
                <Input
                  value={item.title}
                  maxLength={LIMITS.itemTitle}
                  placeholder="כותרת הנקודה"
                  aria-label={`כותרת נקודה ${n + 1}`}
                  onChange={(e) => set({ ...item, title: e.target.value })}
                />
                <Textarea
                  value={item.text ?? ""}
                  rows={2}
                  maxLength={LIMITS.itemText}
                  placeholder="פירוט קצר (לא חובה)"
                  aria-label={`פירוט נקודה ${n + 1}`}
                  onChange={(e) => set({ ...item, text: e.target.value || null })}
                />
              </>
            )}
          />
        </Stack>
      );
    case "faq":
      return (
        <Stack>
          {text("title", "כותרת", "שאלות נפוצות")}
          <Items
            items={c.faq ?? []}
            max={MAX_FAQ}
            addLabel="הוספת שאלה"
            empty={{ q: "", a: "" }}
            onChange={(faq) => onChange({ faq })}
            render={(item, set, n) => (
              <>
                <Input
                  value={item.q}
                  maxLength={LIMITS.faqQ}
                  placeholder="השאלה"
                  aria-label={`שאלה ${n + 1}`}
                  onChange={(e) => set({ ...item, q: e.target.value })}
                />
                <Textarea
                  value={item.a}
                  rows={3}
                  maxLength={LIMITS.faqA}
                  placeholder="התשובה"
                  aria-label={`תשובה ${n + 1}`}
                  onChange={(e) => set({ ...item, a: e.target.value })}
                />
              </>
            )}
          />
        </Stack>
      );
    case "cta":
      return (
        <Stack>
          {text("title", "כותרת", site.business.name)}
          {body("טקסט", "", 3)}
          <Field id={`${section.id}-button`} label="טקסט הכפתור">
            <Input
              id={`${section.id}-button`}
              value={c.button ?? ""}
              maxLength={LIMITS.button}
              placeholder="בדיקת זמינות והזמנה"
              onChange={(e) => onChange({ button: e.target.value })}
            />
          </Field>
        </Stack>
      );
  }
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-10 rounded-md border px-3 text-sm",
              value === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Items<T>({
  items,
  max,
  addLabel,
  empty,
  onChange,
  render,
}: {
  items: T[];
  max: number;
  addLabel: string;
  empty: T;
  onChange: (items: T[]) => void;
  render: (item: T, set: (v: T) => void, n: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, n) => (
        <div key={n} className="flex flex-col gap-2 rounded-md border p-3">
          {render(item, (v) => onChange(items.map((x, i) => (i === n ? v : x))), n)}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== n))}
            className="inline-flex items-center gap-1 self-start text-xs text-destructive hover:underline"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            הסרה
          </button>
        </div>
      ))}
      {items.length < max && (
        <button
          type="button"
          onClick={() => onChange([...items, empty])}
          className="inline-flex min-h-10 items-center gap-2 self-start rounded-md border border-dashed px-3 text-sm hover:bg-muted"
        >
          <Plus className="size-4" aria-hidden="true" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

export function ImagePicker({
  site,
  value,
  onChange,
  label,
  multiple = false,
  extra = [],
  clearLabel,
}: {
  site: PublicSite;
  value: string | string[] | undefined;
  onChange: (v: never) => void;
  label: string;
  multiple?: boolean;
  /** תמונות נוספות לבחירה, לפני התמונות של האתר (בלוגו: הלוגואים שהועלו) */
  extra?: PublicMedia[];
  /** הטקסט של ניקוי הבחירה (ברירת מחדל: "ברירת המחדל (תמונה אוטומטית)") */
  clearLabel?: string;
}) {
  // תמונות בלבד, בלי כפילויות (הנוספות קודם)
  const images: PublicMedia[] = [];
  const seen = new Set<string>();
  for (const m of [...extra, ...allMedia(site)]) {
    if (m.kind !== "image" || !m.url || seen.has(m.id)) continue;
    seen.add(m.id);
    images.push(m);
  }
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const pick = (id: string) => {
    if (multiple) {
      const next = selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id];
      (onChange as (v: string[] | undefined) => void)(next.slice(0, MAX_GALLERY_PICK));
    } else {
      (onChange as (v: string | undefined) => void)(selected.has(id) ? undefined : id);
    }
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {images.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          עוד אין תמונות. מעלים ב"תמונות" (גלריית האתר) או בעמוד של כל יחידה.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-4 gap-1.5">
            {images.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={selected.has(m.id)}
                  aria-label={m.alt || "תמונה"}
                  onClick={() => pick(m.id)}
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden rounded-md border-2",
                    selected.has(m.id) ? "border-primary" : "border-transparent",
                  )}
                >
                  <img
                    src={m.thumb_url ?? m.url ?? ""}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {multiple && selected.has(m.id) && (
                    <span className="absolute top-1 start-1 rounded bg-primary px-1.5 text-[11px] text-primary-foreground">
                      {[...selected].indexOf(m.id) + 1}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => (onChange as (v: undefined) => void)(undefined)}
              className="self-start text-xs text-muted-foreground underline"
            >
              {clearLabel ??
                (multiple ? "ניקוי הבחירה (כל התמונות)" : "ברירת המחדל (תמונה אוטומטית)")}
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}
