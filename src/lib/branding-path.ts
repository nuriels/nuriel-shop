// נתיב קובץ בדלי branding (לוגו / באנר של חנות) שמגיע ממסד הנתונים (site_settings.logo_path —
// בעל החנות קובע אותו). השרת מוריד אותו במפתח השירות, ו-storage-js מצרף את הנתיב לכתובת בלי קידוד —
// כך ש-"../" או תו מיוחד היו מובילים לבקשה במפתח השירות לנתיב אחר בשרת (דלי פרטי, REST).
// מותר רק נתיב רגיל: מקטעים של אותיות לטיניות, ספרות, נקודה, קו תחתון ומקף; בלי "..", בלי "/"
// בהתחלה, ובלי % ? # \. אם המקטע הראשון הוא מזהה חנות (UUID) — הוא חייב להיות של החנות הזו.
// טהור — נבדק ביחידה.

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** הנתיב אם הוא בטוח להורדה מהדלי של החנות; אחרת null */
export function safeBrandingPath(
  raw: string | null | undefined,
  tenantId: string | null | undefined,
): string | null {
  const path = String(raw ?? "").trim();
  if (!path || path.length > 400) return null;
  const parts = path.split("/");
  if (parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) return null;
  const first = parts[0]!;
  if (UUID.test(first) && (!tenantId || first.toLowerCase() !== tenantId.toLowerCase()))
    return null;
  return path;
}
