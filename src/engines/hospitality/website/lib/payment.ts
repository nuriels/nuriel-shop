// הוראות תשלום (מיגרציה 37) — טהור (נבדק ביחידה). "phone" לבד = התשלום הטלפוני של D4, כמו היום.

/** העסק הגדיר הוראות מעבר לתשלום טלפוני (העברה בנקאית / Bit / הוראות משלו) */
export const hasInstructions = (methods: readonly string[] | null | undefined): boolean =>
  (methods ?? []).some((m) => m !== "phone");

/** "העברה בנקאית / Bit / תשלום בטלפון" — "לפי הוראות העסק" רק כשאין אמצעי אחר */
export function methodsText(
  methods: readonly string[] | null | undefined,
  names: Record<string, string>,
): string {
  const list = (methods ?? []).filter((m) => m !== "note").map((m) => names[m] ?? m);
  if (list.length) return list.join(" / ");
  return (methods ?? []).includes("note") ? (names["note"] ?? "") : (names["phone"] ?? "");
}
