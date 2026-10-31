// שמירה: כלי התצוגה המקומית (P0) רצים רק מול מסד ו-API מקומיים.
// כתובת שאינה localhost / 127.0.0.1 / ::1 — עצירה מיידית, לפני שום פעולה.

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return new URL(value.trim().replace(/^postgres(ql)?:/i, "http:")).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** true אם הכתובת (http / https / postgres) מצביעה למחשב המקומי בלבד */
export function isLocalUrl(value) {
  const host = hostOf(value);
  return host !== null && LOCAL_HOSTS.has(host);
}

/** זורק אם אחת הכתובות אינה מקומית — כך אי אפשר להריץ את ההדגמה מול שרת אמיתי */
export function assertLocalTargets(targets) {
  for (const [name, value] of Object.entries(targets)) {
    if (!isLocalUrl(value)) {
      throw new Error(
        `${name} אינו מקומי (${hostOf(value) ?? "חסר או לא תקין"}) — ` +
          "נתוני ההדגמה נוצרים רק בסביבה המקומית. עצירה.",
      );
    }
  }
}
