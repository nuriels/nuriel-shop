// צבעים לערכות העיצוב: ניגודיות (WCAG) והתאמת צבע שהעסק בחר כך שהטקסט יישאר קריא.
// טהור, בלי תלויות; נבדק ביחידה. (מימוש נפרד מזה של החנויות — בלי לייבא קוד Ecommerce.)

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const h = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** הבהירות היחסית (WCAG 2.x) */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 1;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** ערבוב: t=0 → a, t=1 → b */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

/** הטקסט על רקע הצבע: הבהיר או הכהה — מה שקריא יותר */
export function readableOn(bg: string, light = "#ffffff", dark = "#111111"): string {
  return contrast(light, bg) >= contrast(dark, bg) ? light : dark;
}

/**
 * מכהה (או מבהיר) את הצבע עד ניגודיות מינימלית מול הרקע — למשל צבע ההדגשה שהעסק בחר,
 * כשהוא משמש לטקסט קטן על רקע בהיר (4.5:1).
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(parseHex(bg) ?? [255, 255, 255]) > 0.5 ? "#000000" : "#ffffff";
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}
