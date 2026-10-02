/**
 * טעינת כל השורות בעמודים. ה-API של Supabase מחזיר עד מגבלת שורות לבקשה
 * (לרוב 1000) — עם אלפי מוצרים רשימה בבקשה אחת נחתכת בשקט.
 * חובה למיין לפי עמודה ייחודית (למשל id) בסוף המיון, כדי שהעמודים לא יחפפו.
 */
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  let from = 0;
  // עוצרים רק כשעמוד חוזר ריק — עובד גם אם מגבלת השרת קטנה מ-pageSize
  for (;;) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    from += rows.length;
  }
  return { data: all, error: null };
}
