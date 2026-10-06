/**
 * קישור מתוך טקסט חופשי — למשל הודעת שיתוף מאפליקציה:
 * "₪19.90 | עגילי זהב! https://a.aliexpress.com/_mNvXyZ לחצו עכשיו!"
 * מחזיר את הקישור הראשון (בלי פיסוק שנדבק אליו), או null אם אין.
 * דומיין בלי פרוטוקול ("aliexpress.com/item/42.html") — מקבל https://.
 */
export function extractUrlFromText(text: string | null | undefined): string | null {
  const value = (text ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
  if (value === "") return null;
  let candidate = value.match(/https?:\/\/[^\s<>"'״]+/i)?.[0] ?? null;
  if (!candidate) {
    const bare = value.match(/(?:^|[\s(])((?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,24}\/[^\s<>"'״]*)/i);
    if (bare?.[1]) candidate = `https://${bare[1]}`;
  }
  if (!candidate) return null;
  candidate = candidate.replace(/[.,;:!?)\]}'"״׳»…]+$/u, "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
  } catch {
    return null;
  }
  return candidate;
}
