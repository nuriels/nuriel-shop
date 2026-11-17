// "מה חסר לי בגוגל" — בדיקה מהירה ובלי AI של מה שהאתר מציג (לפי הטיוטה בעורך). טהור (נבדק ביחידה).
// בשפה פשוטה, בלי מונחים טכניים: מה חסר ולמה זה חשוב.
import type { PublicSite } from "../types/website";
import type { SiteDesign } from "./design/schema";

export interface ChecklistItem {
  key: string;
  ok: boolean;
  text: string;
}

export function seoChecklist(
  site: Pick<PublicSite, "units" | "gallery" | "properties">,
  design: Pick<SiteDesign, "seo">,
): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  out.push({
    key: "home-title",
    ok: !!design.seo?.title?.trim(),
    text: design.seo?.title?.trim()
      ? "יש כותרת לדף הבית בגוגל"
      : "אין כותרת משלכם לדף הבית בגוגל (מוצג רק שם העסק)",
  });
  out.push({
    key: "home-description",
    ok: !!design.seo?.description?.trim(),
    text: design.seo?.description?.trim()
      ? "יש תיאור לדף הבית בגוגל"
      : "אין תיאור משלכם לדף הבית בגוגל — גוגל יציג משפט אקראי מהאתר",
  });
  const noText = site.units.filter((u) => !u.description?.trim());
  out.push({
    key: "unit-text",
    ok: noText.length === 0,
    text: noText.length
      ? `${noText.length === 1 ? "ליחידה" : `ל-${noText.length} יחידות`} אין טקסט בעמוד: ${noText.map((u) => u.name).join(", ")}`
      : "לכל היחידות יש טקסט בעמוד",
  });
  const noSeo = site.units.filter((u) => !u.seo_description?.trim());
  const counts = new Map<string, number>();
  for (const u of site.units) {
    const d = u.seo_description?.trim();
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const dup = [...counts.values()].some((n) => n > 1);
  out.push({
    key: "unit-description",
    ok: noSeo.length === 0 && !dup,
    text: dup
      ? "לכמה יחידות יש אותו תיאור בגוגל — לכל עמוד כדאי תיאור משלו"
      : noSeo.length
        ? `${noSeo.length === 1 ? "ליחידה אחת" : `ל-${noSeo.length} יחידות`} אין תיאור משלה בגוגל`
        : "לכל יחידה יש תיאור משלה בגוגל",
  });
  const seen = new Set<string>();
  let images = 0;
  let missing = 0;
  for (const m of [
    ...site.units.flatMap((u) => u.media),
    ...site.properties.flatMap((p) => p.media),
    ...site.gallery,
  ]) {
    if (m.kind !== "image" || seen.has(m.id)) continue;
    seen.add(m.id);
    images++;
    if (!m.alt?.trim()) missing++;
  }
  out.push({
    key: "alt",
    ok: missing === 0,
    text: missing
      ? `ל-${missing} מתוך ${images} תמונות אין תיאור (חשוב לגולשים עיוורים ולחיפוש תמונות בגוגל)`
      : "לכל התמונות יש תיאור",
  });
  const phrases = design.seo?.keywords?.length ?? 0;
  out.push({
    key: "phrases",
    ok: phrases > 0,
    text: phrases
      ? `בחרתם ${phrases} ביטויי חיפוש`
      : "עוד לא בחרתם ביטויי חיפוש (מה הגולשים כותבים בגוגל כשהם מחפשים מקום כמו שלכם)",
  });
  return out;
}
