// לוחות העורך: פרטי העסק, עיצוב, מקטעי דף הבית, ושלושת האוספים (שירותים, תיק עבודות, המלצות)
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, Button, Label } from "@/platform/ui";
import { BLOCK_DEFINITIONS, BLOCK_TYPES, type BlockType } from "../../document/blocks";
import type {
  Block,
  ImageRef,
  JsonValue,
  LocalizedText,
  PortfolioItem,
  Service,
  SiteDocument,
  TemplateKey,
  Testimonial,
} from "../../document/schema";
import { MAX_PORTFOLIO_ITEMS, MAX_SERVICES, MAX_TESTIMONIALS, RADII } from "../../document/schema";
import { TEMPLATES } from "../../templates/registry";
import { TEMPLATE_PALETTES } from "../../templates/palettes";
import { contrastRatio, paletteProblems } from "./contrast";
import {
  addBlock,
  homePage,
  moveBlock,
  moveItem,
  newId,
  removeBlock,
  setBlockHidden,
  setBlockProp,
} from "./doc-ops";
import { ParagraphsField, PlainField, RowActions, Section, TextField, ToggleField } from "./fields";
import { ImageField } from "./media";

export type SetDoc = (change: (doc: SiteDocument) => SiteDocument) => void;
type PanelProps = { doc: SiteDocument; setDoc: SetDoc };

// ---------- פרטי העסק ----------
export function BusinessPanel({ doc, setDoc }: PanelProps) {
  const b = doc.business;
  const set = <K extends keyof typeof b>(key: K, value: (typeof b)[K]) =>
    setDoc((d) => ({ ...d, business: { ...d.business, [key]: value } }));
  return (
    <Section title="פרטי העסק" description="מופיעים בכותרת, בפוטר, ביצירת קשר ובכפתור WhatsApp.">
      <TextField label="שם העסק" value={b.name} max={120} onChange={(v) => set("name", v)} />
      <TextField
        label="משפט על העסק (בפוטר)"
        value={b.tagline}
        max={200}
        onChange={(v) => set("tagline", v)}
      />
      <ImageField label="לוגו" value={b.logo} onChange={(v) => set("logo", v)} />
      <PlainField
        label="מספר WhatsApp (בפורמט בינלאומי)"
        value={b.whatsapp}
        max={15}
        placeholder="972501234567"
        hint="ספרות בלבד, עם קידומת המדינה ובלי 0 בהתחלה. ריק — בלי כפתור WhatsApp."
        onChange={(v) => set("whatsapp", v.replace(/[^0-9]/g, ""))}
      />
      <TextField
        label="ההודעה המוכנה ב-WhatsApp"
        value={b.whatsappMessage}
        max={300}
        onChange={(v) => set("whatsappMessage", v)}
      />
      <PlainField
        label="טלפון"
        type="tel"
        value={b.phone}
        max={20}
        onChange={(v) => set("phone", v)}
      />
      <PlainField
        label="אימייל"
        type="email"
        value={b.email}
        max={254}
        onChange={(v) => set("email", v)}
      />
      <TextField label="כתובת" value={b.address} max={200} onChange={(v) => set("address", v)} />
      <TextField label="שעות פעילות" value={b.hours} max={200} onChange={(v) => set("hours", v)} />
      {(["facebook", "instagram", "linkedin"] as const).map((k) => (
        <PlainField
          key={k}
          label={{ facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" }[k]}
          type="url"
          value={b.social[k]}
          max={500}
          placeholder="https://"
          onChange={(v) => set("social", { ...b.social, [k]: v })}
        />
      ))}
    </Section>
  );
}

// ---------- עיצוב ----------
const COLOR_LABELS: Record<keyof SiteDocument["theme"]["palette"], string> = {
  background: "רקע",
  surface: "משטח (כרטיסים)",
  text: "טקסט",
  muted: "טקסט משני",
  accent: "צבע הדגשה",
  accentText: "טקסט על צבע ההדגשה",
  soft: "רקע רך",
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
          {value}
        </span>
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border"
        />
      </div>
    </div>
  );
}

export function DesignPanel({ doc, setDoc }: PanelProps) {
  const problems = paletteProblems(doc.theme.palette);
  const setTemplate = (key: TemplateKey) =>
    setDoc((d) => ({
      ...d,
      template: key,
      theme: {
        ...d.theme,
        palette:
          key === "portfolio" || key === "elegant"
            ? { ...TEMPLATE_PALETTES[key] }
            : d.theme.palette,
      },
    }));
  return (
    <Section
      title="עיצוב"
      description="תבנית, צבעים ופינות. הצבעים נבדקים לניגודיות (תקן נגישות, רמה AA)."
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">תבנית</legend>
        {Object.values(TEMPLATES).map((t) => (
          <label
            key={t.key}
            className={`flex items-start gap-3 rounded-md border p-3 ${t.status === "planned" ? "opacity-60" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="bp-template"
              className="mt-1"
              checked={doc.template === t.key}
              disabled={t.status === "planned"}
              onChange={() => setTemplate(t.key)}
            />
            <span>
              <span className="font-medium">{t.label.he}</span>{" "}
              {t.status === "planned" && <Badge variant="secondary">בקרוב</Badge>}
              <span className="block text-sm text-muted-foreground">{t.description.he}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          בחירת תבנית מחליפה גם את ערכת הצבעים להתחלה של התבנית.
        </p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">צבעים</legend>
        {(Object.keys(COLOR_LABELS) as (keyof typeof COLOR_LABELS)[]).map((k) => (
          <ColorField
            key={k}
            label={COLOR_LABELS[k]}
            value={doc.theme.palette[k]}
            onChange={(v) =>
              setDoc((d) => ({
                ...d,
                theme: { ...d.theme, palette: { ...d.theme.palette, [k]: v } },
              }))
            }
          />
        ))}
        <div role="status" aria-live="polite" className="text-sm">
          {problems.length === 0 ? (
            <p className="text-emerald-800">כל הצבעים עוברים את בדיקת הניגודיות (AA).</p>
          ) : (
            <ul className="space-y-1 text-amber-900">
              {problems.map((p) => (
                <li key={p.pair}>
                  ניגודיות נמוכה — {p.pair}: {p.ratio}:1 (נדרש 4.5:1)
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          כפתור: {contrastRatio(doc.theme.palette.accentText, doc.theme.palette.accent)}:1 · טקסט:{" "}
          {contrastRatio(doc.theme.palette.text, doc.theme.palette.background)}:1
        </p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">פינות</legend>
        <div className="flex gap-2">
          {RADII.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="bp-radius"
                checked={doc.theme.radius === r}
                onChange={() => setDoc((d) => ({ ...d, theme: { ...d.theme, radius: r } }))}
              />
              {{ sharp: "חדות", soft: "מעוגלות מעט", round: "עגולות" }[r]}
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
}

// ---------- מקטעים ----------
type Props = Record<string, JsonValue>;
const asText = (v: JsonValue | undefined) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as LocalizedText) : { he: "" };

function BlockForm({ block, setDoc }: { block: Block; setDoc: SetDoc }) {
  const p = block.props as Props;
  const set = (key: string, value: unknown) =>
    setDoc((d) => setBlockProp(d, block.id, key, value as JsonValue));
  const text = (key: string, label: string, max: number, multiline = false) => (
    <TextField
      key={key}
      label={label}
      value={asText(p[key])}
      max={max}
      multiline={multiline}
      onChange={(v) => set(key, v)}
    />
  );
  const button = (key: string, label: string) => {
    const v = (p[key] ?? { label: { he: "" }, href: "" }) as unknown as {
      label: LocalizedText;
      href: string;
    };
    return (
      <div key={key} className="space-y-2 rounded-md bg-muted/40 p-3">
        <TextField
          label={`${label} — טקסט`}
          value={v.label}
          max={60}
          onChange={(l) => set(key, { ...v, label: l })}
        />
        <PlainField
          label={`${label} — קישור`}
          value={v.href}
          max={500}
          hint="#contact (מקטע בדף), https://…, mailto:… או tel:…"
          onChange={(h) => set(key, { ...v, href: h })}
        />
      </div>
    );
  };
  switch (block.type as BlockType) {
    case "hero":
      return (
        <>
          {text("eyebrow", "שורה מעל הכותרת", 80)}
          {text("title", "כותרת ראשית (H1)", 140)}
          {text("subtitle", "משפט משנה", 300, true)}
          <ImageField
            label="תמונת הפתיח"
            value={p["image"] as unknown as ImageRef}
            onChange={(v) => set("image", v)}
          />
          {button("primary", "כפתור ראשי")}
          {button("secondary", "כפתור משני")}
        </>
      );
    case "about":
      return (
        <>
          {text("eyebrow", "שורה מעל הכותרת", 80)}
          {text("title", "כותרת", 140)}
          <ParagraphsField
            label="פסקאות"
            value={(p["paragraphs"] as unknown as LocalizedText[]) ?? []}
            maxEach={1500}
            maxCount={14}
            onChange={(v) => set("paragraphs", v)}
          />
          <ImageField
            label="תמונה"
            value={p["image"] as unknown as ImageRef}
            onChange={(v) => set("image", v)}
          />
        </>
      );
    case "services":
    case "portfolio":
    case "testimonials":
      return (
        <>
          {text("eyebrow", "שורה מעל הכותרת", 80)}
          {text("title", "כותרת", 140)}
          {text("intro", "פתיח קצר", 500, true)}
          {block.type === "portfolio" && (
            <>
              <ToggleField
                label="סינון לפי קטגוריה"
                checked={p["filter"] !== false}
                onChange={(v) => set("filter", v)}
              />
              <ToggleField
                label="שמות מתחת לעבודות"
                checked={p["showTitles"] !== false}
                onChange={(v) => set("showTitles", v)}
              />
            </>
          )}
          <p className="text-xs text-muted-foreground">
            התוכן עצמו — בלשונית{" "}
            {block.type === "services"
              ? "השירותים"
              : block.type === "portfolio"
                ? "תיק העבודות"
                : "ההמלצות"}
            .
          </p>
        </>
      );
    case "cta":
      return (
        <>
          {text("title", "כותרת", 140)}
          {text("text", "טקסט", 400, true)}
          {button("button", "כפתור")}
          <ToggleField
            label="כפתור WhatsApp"
            checked={p["whatsapp"] !== false}
            onChange={(v) => set("whatsapp", v)}
          />
        </>
      );
    case "contact":
      return (
        <>
          {text("eyebrow", "שורה מעל הכותרת", 80)}
          {text("title", "כותרת", 140)}
          {text("intro", "פתיח קצר", 500, true)}
          <ToggleField
            label="הצגת WhatsApp"
            checked={p["showWhatsapp"] !== false}
            onChange={(v) => set("showWhatsapp", v)}
          />
          <ToggleField
            label="הצגת טלפון"
            checked={p["showPhone"] !== false}
            onChange={(v) => set("showPhone", v)}
          />
          <ToggleField
            label="הצגת אימייל"
            checked={p["showEmail"] !== false}
            onChange={(v) => set("showEmail", v)}
          />
          <p className="text-xs text-muted-foreground">
            טופס פנייה (לתיבת הפניות של Nuriel) — יתווסף בשלב הטפסים.
          </p>
        </>
      );
    case "text":
      return (
        <>
          {text("title", "כותרת", 140)}
          <ParagraphsField
            label="פסקאות"
            value={(p["paragraphs"] as unknown as LocalizedText[]) ?? []}
            maxEach={2000}
            maxCount={20}
            onChange={(v) => set("paragraphs", v)}
          />
        </>
      );
  }
}

export function BlocksPanel({ doc, setDoc }: PanelProps) {
  const blocks = homePage(doc).blocks;
  const [open, setOpen] = useState<string | null>(blocks[0]?.id ?? null);
  const [adding, setAdding] = useState<BlockType>("text");
  return (
    <Section
      title="מקטעי דף הבית"
      description="סדר, הסתרה ועריכה של כל מקטע. מקטע מוסתר לא מופיע באתר."
    >
      <ol className="space-y-2">
        {blocks.map((b, i) => {
          const label = BLOCK_DEFINITIONS[b.type as BlockType]?.label.he ?? b.type;
          const isOpen = open === b.id;
          return (
            <li key={b.id} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 p-2">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-start font-medium"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : b.id)}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                  {label}
                  {b.hidden && <Badge variant="secondary">מוסתר</Badge>}
                </button>
                <RowActions
                  label={`המקטע "${label}"`}
                  index={i}
                  count={blocks.length}
                  hidden={b.hidden}
                  onMove={(d) => setDoc((doc) => moveBlock(doc, b.id, d))}
                  onToggle={() => setDoc((doc) => setBlockHidden(doc, b.id, !b.hidden))}
                  onRemove={
                    b.type === "hero" ? undefined : () => setDoc((doc) => removeBlock(doc, b.id))
                  }
                />
              </div>
              {isOpen && (
                <div className="space-y-4 border-t p-3">
                  <BlockForm block={b} setDoc={setDoc} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="bp-add-block">הוספת מקטע</Label>
          <select
            id="bp-add-block"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={adding}
            onChange={(e) => setAdding(e.target.value as BlockType)}
          >
            {/* פתיח אחד לעמוד: אפשר להוסיף רק אם אין */}
            {BLOCK_TYPES.filter((t) => t !== "hero" || !blocks.some((b) => b.type === "hero")).map(
              (t) => (
                <option key={t} value={t}>
                  {BLOCK_DEFINITIONS[t].label.he}
                </option>
              ),
            )}
          </select>
        </div>
        <Button type="button" variant="outline" onClick={() => setDoc((d) => addBlock(d, adding))}>
          הוספה
        </Button>
      </div>
    </Section>
  );
}

// ---------- אוספים ----------
function ListShell<T extends { id: string; hidden: boolean }>({
  items,
  max,
  noun,
  title,
  addLabel,
  onChange,
  make,
  render,
}: {
  items: T[];
  max: number;
  noun: string;
  title: (item: T) => string;
  addLabel: string;
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, update: (item: T) => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {items.length} / {max}
      </p>
      <ol className="space-y-2">
        {items.map((item, i) => {
          const isOpen = open === item.id;
          const name = title(item) || `${noun} ללא שם`;
          return (
            <li key={item.id} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 p-2">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-start"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : item.id)}
                >
                  <ChevronDown
                    className={`size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="line-clamp-1">{name}</span>
                  {item.hidden && <Badge variant="secondary">מוסתר</Badge>}
                </button>
                <RowActions
                  label={name}
                  index={i}
                  count={items.length}
                  hidden={item.hidden}
                  onMove={(d) => onChange(moveItem(items, i, d))}
                  onToggle={() =>
                    onChange(items.map((x) => (x.id === item.id ? { ...x, hidden: !x.hidden } : x)))
                  }
                  onRemove={() => onChange(items.filter((x) => x.id !== item.id))}
                />
              </div>
              {isOpen && (
                <div className="space-y-3 border-t p-3">
                  {render(item, (next) =>
                    onChange(items.map((x) => (x.id === item.id ? next : x))),
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {items.length < max && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const item = make();
            onChange([...items, item]);
            setOpen(item.id);
          }}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}

export function ServicesPanel({ doc, setDoc }: PanelProps) {
  const items = doc.collections.services;
  const set = (next: Service[]) =>
    setDoc((d) => ({ ...d, collections: { ...d.collections, services: next } }));
  return (
    <Section title="שירותים" description="מוצגים במקטע השירותים, לפי הסדר.">
      <ListShell
        items={items}
        max={MAX_SERVICES}
        noun="שירות"
        title={(s) => s.title.he}
        addLabel="הוספת שירות"
        onChange={set}
        make={() => ({
          id: newId("service", items),
          title: { he: "" },
          text: { he: "" },
          icon: null,
          hidden: false,
        })}
        render={(s, update) => (
          <>
            <TextField
              label="שם השירות"
              value={s.title}
              max={120}
              onChange={(v) => update({ ...s, title: v })}
            />
            <TextField
              label="תיאור"
              value={s.text}
              max={1200}
              multiline
              onChange={(v) => update({ ...s, text: v })}
            />
          </>
        )}
      />
    </Section>
  );
}

export function PortfolioPanel({ doc, setDoc }: PanelProps) {
  const { categories, items } = doc.collections.portfolio;
  const setPortfolio = (next: Partial<SiteDocument["collections"]["portfolio"]>) =>
    setDoc((d) => ({
      ...d,
      collections: { ...d.collections, portfolio: { ...d.collections.portfolio, ...next } },
    }));
  return (
    <Section
      title="תיק עבודות"
      description="עבודות עם תמונה, שם וקטגוריות. הגולשים מסננים לפי קטגוריה."
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">קטגוריות</legend>
        {categories.map((c, i) => (
          <div key={c.id} className="flex items-end gap-1">
            <div className="flex-1">
              <TextField
                label={`קטגוריה ${i + 1}`}
                value={c.label}
                max={80}
                onChange={(v) =>
                  setPortfolio({
                    categories: categories.map((x) => (x.id === c.id ? { ...x, label: v } : x)),
                  })
                }
              />
            </div>
            <RowActions
              label={`הקטגוריה "${c.label.he}"`}
              index={i}
              count={categories.length}
              onMove={(d) => setPortfolio({ categories: moveItem(categories, i, d) })}
              onRemove={() =>
                setPortfolio({
                  categories: categories.filter((x) => x.id !== c.id),
                  items: items.map((it) => ({
                    ...it,
                    categories: it.categories.filter((x) => x !== c.id),
                  })),
                })
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setPortfolio({
              categories: [...categories, { id: newId("cat", categories), label: { he: "" } }],
            })
          }
        >
          הוספת קטגוריה
        </Button>
      </fieldset>
      <ListShell<PortfolioItem>
        items={items}
        max={MAX_PORTFOLIO_ITEMS}
        noun="עבודה"
        title={(w) => w.title.he}
        addLabel="הוספת עבודה"
        onChange={(next) => setPortfolio({ items: next })}
        make={() => ({
          id: newId("work", items),
          title: { he: "" },
          text: { he: "" },
          categories: [],
          image: { media: null, alt: { he: "" } },
          hidden: false,
        })}
        render={(w, update) => (
          <>
            <TextField
              label="שם העבודה"
              value={w.title}
              max={160}
              onChange={(v) => update({ ...w, title: v })}
            />
            <TextField
              label="תיאור קצר"
              value={w.text}
              max={600}
              multiline
              onChange={(v) => update({ ...w, text: v })}
            />
            <ImageField
              label="תמונה"
              value={w.image}
              onChange={(v) => update({ ...w, image: v })}
            />
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">קטגוריות</legend>
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={w.categories.includes(c.id)}
                    onChange={(e) =>
                      update({
                        ...w,
                        categories: e.target.checked
                          ? [...w.categories, c.id].slice(0, 5)
                          : w.categories.filter((x) => x !== c.id),
                      })
                    }
                  />
                  {c.label.he || "קטגוריה ללא שם"}
                </label>
              ))}
            </fieldset>
          </>
        )}
      />
    </Section>
  );
}

export function TestimonialsPanel({ doc, setDoc }: PanelProps) {
  const items = doc.collections.testimonials;
  const set = (next: Testimonial[]) =>
    setDoc((d) => ({ ...d, collections: { ...d.collections, testimonials: next } }));
  return (
    <Section
      title="המלצות"
      description="טקסט ושם. מומלץ טקסט ולא צילום מסך — כך גם קוראי מסך וגוגל קוראים אותו. מפרסמים רק בהסכמת הממליץ."
    >
      <ListShell
        items={items}
        max={MAX_TESTIMONIALS}
        noun="המלצה"
        title={(t) => t.author.he || t.quote.he.slice(0, 40)}
        addLabel="הוספת המלצה"
        onChange={set}
        make={() => ({
          id: newId("t", items),
          quote: { he: "" },
          author: { he: "" },
          role: { he: "" },
          image: { media: null, alt: { he: "" } },
          hidden: false,
        })}
        render={(t, update) => (
          <>
            <TextField
              label="ההמלצה"
              value={t.quote}
              max={1500}
              multiline
              onChange={(v) => update({ ...t, quote: v })}
            />
            <TextField
              label="שם הממליץ"
              value={t.author}
              max={120}
              onChange={(v) => update({ ...t, author: v })}
            />
            <TextField
              label="תפקיד / הקשר (לא חובה)"
              value={t.role}
              max={120}
              onChange={(v) => update({ ...t, role: v })}
            />
            <ImageField
              label="צילום ההמלצה המקורית (עד שיש טקסט)"
              value={t.image}
              onChange={(v) => update({ ...t, image: v })}
            />
          </>
        )}
      />
    </Section>
  );
}
