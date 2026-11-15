// ניגודיות צבעים לפי WCAG 2.x (IS 5568 — רמה AA): 4.5:1 לטקסט רגיל. טהור, נבדק ביחידה.

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => channel(parseInt(x, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const AA = 4.5;

/** הזוגות שחייבים לעבור AA בתבנית */
export function paletteProblems(p: {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  soft: string;
}): { pair: string; ratio: number }[] {
  const pairs: [string, string, string][] = [
    ["טקסט על הרקע", p.text, p.background],
    ["טקסט משני על הרקע", p.muted, p.background],
    ["טקסט על משטח", p.text, p.surface],
    ["טקסט משני על משטח", p.muted, p.surface],
    ["טקסט על רקע רך", p.text, p.soft],
    ["טקסט משני על רקע רך", p.muted, p.soft],
    ["כפתור (טקסט על צבע ההדגשה)", p.accentText, p.accent],
    ["צבע ההדגשה על הרקע", p.accent, p.background],
  ];
  return pairs
    .map(([pair, fg, bg]) => ({ pair, ratio: contrastRatio(fg, bg) }))
    .filter((x) => x.ratio < AA);
}
