// צבע המותג של החנות (site_settings.brand_color) → משתני העיצוב של האתר.
// הצבע שבחר המנהל צובע את הכותרת העליונה, התחתונה והכפתורים הראשיים, וצבע
// הטקסט עליהם (לבן / כהה) נבחר אוטומטית לפי הניגודיות הטובה יותר.

const HEX = /^#([0-9a-f]{6})$/;

/** "#1E40AF" / "1e40af" → "#1e40af"; קלט לא תקין → null (= עיצוב ברירת המחדל) */
export function normalizeBrandColor(value: string | null | undefined): string | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX.test(withHash) ? withHash : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** בהירות יחסית לפי WCAG */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** יחס ניגודיות WCAG בין שני צבעים (1–21) */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#111111";

/** צבע הטקסט שיושב על צבע המותג — לבן או כהה, מה שקריא יותר */
export function textColorOn(hex: string): string {
  return contrastRatio(hex, LIGHT_TEXT) >= contrastRatio(hex, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** צבע בהיר מדי לטקסט על רקע לבן (כותרות / קישורים בצבע המותג) */
export function isTooLightForText(hex: string): boolean {
  return contrastRatio(hex, "#ffffff") < 3;
}

/** sRGB → OKLCH, כדי לגזור גוונים בהירים / כהים מאותו צבע */
function toOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = rgb(hex).map(toLinear) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const oklch = (l: number, c: number, h: number, alpha?: number) =>
  `oklch(${clamp(l, 0, 1).toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}${alpha === undefined ? "" : ` / ${alpha}`})`;

/**
 * ה-CSS שמחליף את צבעי ברירת המחדל בצבע המותג, או null כשאין צבע.
 * לא חל במצבי הנגישות (ניגודיות גבוהה / צבעים הפוכים) — הם קודמים למיתוג.
 */
export function brandThemeCss(color: string | null | undefined): string | null {
  const hex = normalizeBrandColor(color);
  if (!hex) return null;
  const fg = textColorOn(hex);
  const { l, c, h } = toOklch(hex);
  // בהיר → מעט כהה יותר בתחתית הפס; כהה → מעט בהיר יותר בראשו
  const top = oklch(l + 0.025, c, h);
  const bottom = oklch(l - 0.035, c, h);
  const glow = oklch(l + 0.09, c, h, 0.55);
  return `:root:not(.a11y-contrast):not(.a11y-invert){--primary:${hex};--primary-foreground:${fg};--ring:${hex};--sidebar-primary:${hex};--sidebar-primary-foreground:${fg};--sidebar-ring:${hex};--cellar-base:${hex};--cellar-top:${top};--cellar-bottom:${bottom};--cellar-glow:${glow};--cellar-foreground:${fg}}`;
}

/** צבעים מוכנים לבחירה מהירה בהגדרות */
export const BRAND_PRESETS = [
  { color: "#000000", label: "שחור" },
  { color: "#1e3a8a", label: "כחול" },
  { color: "#0f766e", label: "טורקיז" },
  { color: "#166534", label: "ירוק" },
  { color: "#7f1d1d", label: "בורדו" },
  { color: "#b91c1c", label: "אדום" },
  { color: "#c2410c", label: "כתום" },
  { color: "#6d28d9", label: "סגול" },
  { color: "#be185d", label: "ורוד" },
  { color: "#78350f", label: "חום" },
] as const;
