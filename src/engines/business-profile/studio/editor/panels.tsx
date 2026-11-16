// לוחות העורך: פרטי העסק, עיצוב, מקטעי דף הבית, ושלושת האוספים (שירותים, תיק עבודות, המלצות)
import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import {
  FONT_ROLES,
  MAX_PORTFOLIO_ITEMS,
  MAX_SERVICES,
  MAX_TESTIMONIALS,
  RADII,
  type FontRole,
} from "../../document/schema";
import { studioUploadFont } from "../../api/media.functions";
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
import {
  ParagraphsField,
  PlainField,
  RowActions,
  Section,
  SelectField,
  TextField,
  ToggleField,
} from "./fields";
import { ImageField, MEDIA_QUERY } from "./media";

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
          key === "portfolio" || key === "elegant" || key === "classic"
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
      <TokensFields doc={doc} setDoc={setDoc} />
      <TypographyFields doc={doc} setDoc={setDoc} />
      <ChromeFields doc={doc} setDoc={setDoc} />
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

// ---------- צבעים נוספים של התבנית ----------
function TokensFields({ doc, setDoc }: PanelProps) {
  const template = TEMPLATES[doc.template];
  if (!template.tokens?.length) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">צבעים נוספים של התבנית</legend>
      {template.tokens.map((tk) => (
        <ColorField
          key={tk.key}
          label={tk.label}
          value={(doc.theme.tokens[tk.key] ?? tk.default).toLowerCase()}
          onChange={(v) =>
            setDoc((d) => ({
              ...d,
              theme: { ...d.theme, tokens: { ...d.theme.tokens, [tk.key]: v } },
            }))
          }
        />
      ))}
    </fieldset>
  );
}

// ---------- גופנים ----------
const BUILTIN_FONTS = ["Assistant", "Rubik"];
const ROLE_LABELS: Record<FontRole, string> = {
  display: "כותרת ראשית ותצוגה",
  heading: "כותרות המקטעים",
  body: "טקסט",
  ui: "שדות טופס ופוטר",
};

function TypographyFields({ doc, setDoc }: PanelProps) {
  const qc = useQueryClient();
  const upload = useServerFn(studioUploadFont);
  const fileRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState("");
  const [weight, setWeight] = useState("400");
  const [style, setStyle] = useState("normal");
  const [range, setRange] = useState("");
  const [license, setLicense] = useState("");
  const template = TEMPLATES[doc.template];
  const families = [...new Set([...doc.theme.fonts.map((f) => f.family), ...BUILTIN_FONTS])];
  const m = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("בחרו קובץ WOFF2");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("family", family.trim());
      fd.set("weight", weight.trim());
      fd.set("style", style);
      fd.set("unicodeRange", range.trim());
      fd.set("license", license.trim());
      return upload({ data: fd });
    },
    onSuccess: (r) => {
      qc.setQueryData(MEDIA_QUERY, r.library);
      setDoc((d) => ({
        ...d,
        theme: {
          ...d.theme,
          fonts: [
            ...d.theme.fonts,
            {
              family: family.trim(),
              weight: weight.trim(),
              style: style as "normal" | "italic",
              unicodeRange: range.trim(),
              file: { media: r.id },
            },
          ],
        },
      }));
      if (fileRef.current) fileRef.current.value = "";
      setRange("");
      toast.success("הגופן נשמר בספרייה ונוסף לאתר");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ההעלאה נכשלה"),
  });
  const fileId = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">גופנים</legend>
      {FONT_ROLES.map((role) => (
        <SelectField
          key={role}
          label={ROLE_LABELS[role]}
          value={doc.theme.typography[role]}
          options={[
            [
              "",
              `ברירת המחדל של התבנית${template.fonts?.[role] ? ` (${template.fonts[role]})` : ""}`,
            ],
            ...families.map((f) => [f, f] as [string, string]),
          ]}
          onChange={(v) =>
            setDoc((d) => ({
              ...d,
              theme: { ...d.theme, typography: { ...d.theme.typography, [role]: v } },
            }))
          }
        />
      ))}
      {doc.theme.fonts.length > 0 && (
        <ul className="space-y-1 text-sm">
          {doc.theme.fonts.map((f, i) => (
            <li
              key={`${f.file.media}-${i}`}
              className="flex items-center justify-between gap-2 rounded border px-2 py-1"
            >
              <span dir="ltr">
                {f.family} · {f.weight}
                {f.style === "italic" ? " · italic" : ""}
                {f.unicodeRange ? ` · ${f.unicodeRange.slice(0, 20)}…` : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    theme: { ...d.theme, fonts: d.theme.fonts.filter((_, j) => j !== i) },
                  }))
                }
              >
                הסרה מהאתר
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <p className="text-sm font-medium">הוספת גופן (WOFF2, עד 2MB)</p>
        <p className="text-xs text-muted-foreground">
          רק גופן שמותר להשתמש בו באתר (למשל Google Fonts ברישיון OFL, או גופן שנרכש עם רישיון רשת).
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={fileId}>קובץ</Label>
          <input
            id={fileId}
            ref={fileRef}
            type="file"
            accept=".woff2,font/woff2"
            className="block w-full text-sm"
          />
        </div>
        <PlainField
          label="שם המשפחה (כמו שיופיע ב-CSS)"
          value={family}
          max={48}
          onChange={setFamily}
        />
        <PlainField
          label="משקל (400, או טווח לגופן משתנה: 200 800)"
          value={weight}
          max={7}
          onChange={setWeight}
        />
        <SelectField
          label="סגנון"
          value={style}
          options={[
            ["normal", "רגיל"],
            ["italic", "נטוי"],
          ]}
          onChange={setStyle}
        />
        <PlainField
          label="טווח תווים (לא חובה, למשל U+0590-05FF)"
          value={range}
          max={2000}
          onChange={setRange}
        />
        <PlainField
          label="רישיון (לא חובה, למשל OFL 1.1)"
          value={license}
          max={120}
          onChange={setLicense}
        />
        <Button type="button" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "מעלה…" : "העלאת הגופן"}
        </Button>
      </div>
    </fieldset>
  );
}

// ---------- חלקי האתר ----------
function ChromeFields({ doc, setDoc }: PanelProps) {
  const c = doc.theme.chrome;
  const set = (patch: Partial<typeof c>) =>
    setDoc((d) => ({ ...d, theme: { ...d.theme, chrome: { ...d.theme.chrome, ...patch } } }));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">חלקי האתר</legend>
      <SelectField
        label="כותרת עליונה"
        value={c.header}
        options={[
          ["bar", "פס עם שם העסק וניווט"],
          ["none", "בלי כותרת עליונה"],
        ]}
        onChange={(v) => set({ header: v as "bar" | "none" })}
      />
      <SelectField
        label="פוטר"
        value={c.footer}
        options={[
          ["full", "מלא (שם, משפט, רשתות)"],
          ["strip", "רצועה אחת"],
        ]}
        onChange={(v) => set({ footer: v as "full" | "strip" })}
      />
      <ToggleField
        label="כפתור WhatsApp צף"
        checked={c.floatingWhatsapp}
        onChange={(v) => set({ floatingWhatsapp: v })}
      />
    </fieldset>
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
  const choice = (key: string, label: string, options: [string, string][]) => (
    <SelectField
      key={key}
      label={label}
      value={String(p[key] ?? options[0]![0])}
      options={options}
      onChange={(v) => set(key, v)}
    />
  );
  const image = (key: string, label: string) => (
    <ImageField
      key={key}
      label={label}
      value={(p[key] as unknown as ImageRef) ?? { media: null, alt: { he: "" } }}
      onChange={(v) => set(key, v)}
    />
  );
  switch (block.type as BlockType) {
    case "hero":
      return (
        <>
          {text("eyebrow", "שורה מעל הכותרת", 80)}
          {text("titleLead", "שורת פתיחה קטנה בכותרת (לא חובה)", 120)}
          {text("title", "כותרת ראשית (H1)", 140)}
          {text("subtitle", "משפט משנה", 300, true)}
          {text("tagline", "משפט מודגש אחרי משפט המשנה (לא חובה)", 200)}
          {image("image", "תמונת הפתיח")}
          {choice("layout", "פריסה", [
            ["split", "טקסט ותמונה זה לצד זה"],
            ["cover", "תמונת רקע מלאה"],
            ["centered", "ממורכז, בלי תמונה"],
          ])}
          <ToggleField
            label="הלוגו בתוך הפתיח"
            checked={p["showLogo"] === true}
            onChange={(v) => set("showLogo", v)}
          />
          {button("primary", "כפתור ראשי")}
          {choice("primaryIcon", "אייקון בכפתור הראשי", [
            ["none", "בלי"],
            ["whatsapp", "WhatsApp"],
          ])}
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
          {image("image", "תמונה (כשאין קרוסלה)")}
          {image("titleImage", "כותרת כתמונה (לא חובה — הכותרת הכתובה נשארת לקוראי מסך)")}
          <SlidesField
            value={(p["slides"] as unknown as AboutSlide[]) ?? []}
            onChange={(v) => set("slides", v)}
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
          {text("titleAccent", "המשך הכותרת בצבע ההדגשה (לא חובה)", 60)}
          {text("intro", "פתיח קצר", 500, true)}
          {block.type === "portfolio" && (
            <>
              <ToggleField
                label="סינון לפי קטגוריה"
                checked={p["filter"] !== false}
                onChange={(v) => set("filter", v)}
              />
              <ToggleField
                label='כפתור "הכול" בסינון'
                checked={p["showAll"] !== false}
                onChange={(v) => set("showAll", v)}
              />
              {choice("layout", "פריסת העבודות", [
                ["grid", "רשת אחידה"],
                ["masonry", "Masonry — כל עבודה ביחס המקורי"],
              ])}
              <ToggleField
                label="שמות מתחת לעבודות"
                checked={p["showTitles"] !== false}
                onChange={(v) => set("showTitles", v)}
              />
            </>
          )}
          {block.type === "testimonials" && (
            <>
              {choice("layout", "תצוגה", [
                ["cards", "כרטיסים"],
                ["marquee", "גלילה רציפה"],
              ])}
              {image("background", "תמונת רקע למקטע (לא חובה)")}
              {button("button", "כפתור מתחת להמלצות (לא חובה)")}
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
    case "form": {
      const fields = (p["fields"] ?? {}) as unknown as Record<string, LocalizedText>;
      const field = (k: string, label: string) => (
        <TextField
          key={k}
          label={label}
          value={fields[k]}
          max={k === "message" ? 80 : 60}
          onChange={(v) => set("fields", { ...fields, [k]: v })}
        />
      );
      return (
        <>
          {text("title", "כותרת", 160)}
          {choice("layout", "פריסה", [
            ["beside", "הכותרת לצד הטופס"],
            ["stacked", "הכותרת מעל הטופס"],
          ])}
          {choice("tone", "רקע", [
            ["light", "בהיר"],
            ["dark", "כהה"],
          ])}
          {image("background", "תמונת רקע (לא חובה)")}
          {field("name", "שדה שם — טקסט מנחה")}
          {field("email", "שדה אימייל — טקסט מנחה")}
          {field("phone", "שדה טלפון — טקסט מנחה")}
          {field("message", "שדה ההודעה — טקסט מנחה")}
          {text("submit", "כפתור השליחה", 60)}
          <p className="text-xs text-muted-foreground">
            השליחה תחובר לתיבת הפניות בשלב הטפסים. עד אז, באתר החי מוצג במקומו כפתור WhatsApp.
          </p>
        </>
      );
    }
    case "media":
      return (
        <>
          {image("image", "תמונה")}
          {choice("align", "יישור", [
            ["start", "לימין"],
            ["center", "למרכז"],
            ["end", "לשמאל"],
          ])}
          <PlainField
            label="רוחב מרבי (פיקסלים)"
            type="number"
            value={String(p["width"] ?? 320)}
            max={4}
            onChange={(v) => set("width", Math.max(40, Math.min(1400, Number(v) || 320)))}
          />
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
          iconImage: { media: null, alt: { he: "" } },
          iconBg: "",
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
            <ImageField
              label="אייקון (תמונה, לא חובה)"
              value={s.iconImage}
              onChange={(v) => update({ ...s, iconImage: v })}
            />
            <ColorField
              label="צבע העיגול של האייקון"
              value={s.iconBg || "#ffffff"}
              onChange={(v) => update({ ...s, iconBg: v })}
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
          devices: "all",
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
            <SelectField
              label="איפה מוצגת"
              value={w.devices}
              options={[
                ["all", "בכל מכשיר"],
                ["desktop", "רק במחשב"],
                ["mobile", "רק בנייד"],
              ]}
              onChange={(v) => update({ ...w, devices: v as PortfolioItem["devices"] })}
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

// ---------- קרוסלת האודות ----------
type AboutSlide = { image: ImageRef; button: { label: LocalizedText; href: string } };

function SlidesField({
  value,
  onChange,
}: {
  value: AboutSlide[];
  onChange: (v: AboutSlide[]) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">קרוסלת תמונות (לא חובה)</legend>
      {value.map((sl, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">תמונה {i + 1}</span>
            <RowActions
              label={`תמונה ${i + 1}`}
              index={i}
              count={value.length}
              onMove={(d) => onChange(moveItem(value, i, d))}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          </div>
          <ImageField
            label={`תמונה ${i + 1}`}
            value={sl.image}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, image: v } : x)))}
          />
          <TextField
            label="כפתור מתחת לתמונה — טקסט"
            value={sl.button.label}
            max={60}
            onChange={(l) =>
              onChange(
                value.map((x, j) => (j === i ? { ...x, button: { ...x.button, label: l } } : x)),
              )
            }
          />
          <PlainField
            label="כפתור מתחת לתמונה — קישור"
            value={sl.button.href}
            max={500}
            onChange={(h) =>
              onChange(
                value.map((x, j) => (j === i ? { ...x, button: { ...x.button, href: h } } : x)),
              )
            }
          />
        </div>
      ))}
      {value.length < 8 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...value,
              { image: { media: null, alt: { he: "" } }, button: { label: { he: "" }, href: "" } },
            ])
          }
        >
          הוספת תמונה לקרוסלה
        </Button>
      )}
    </fieldset>
  );
}
