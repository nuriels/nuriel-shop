// שלב א' 7: החבילות באתר — חיפוש לפי הכתובת, היחידה, התמונות (מהגלריות שכבר באתר — בלי עותקים)
// והתקופה. טהור — נבדק ביחידה.
import type { PublicPackage } from "../../types/packages";
import type { PublicMedia, PublicSite, PublicUnit } from "../../types/website";
import { longDate } from "./format";
import { allMedia, unitCover } from "./media";

export function sitePackages(site: PublicSite): PublicPackage[] {
  // רק חבילות שהיחידה שלהן באתר (יחידה שהוסתרה — גם החבילה לא מוצגת)
  return (site.packages ?? []).filter((p) => site.units.some((u) => u.id === p.unit_id));
}

export function findPackage(site: PublicSite, slug: string | undefined): PublicPackage | undefined {
  if (!slug) return undefined;
  const s = safeDecode(slug);
  return sitePackages(site).find((p) => p.slug === s || p.slug === slug);
}

export function packageUnit(pkg: PublicPackage, site: PublicSite): PublicUnit | undefined {
  return site.units.find((u) => u.id === pkg.unit_id);
}

/** התמונות שנבחרו לחבילה, בסדר שנבחר; בלי — התמונה של היחידה */
export function packageImages(pkg: PublicPackage, site: PublicSite): PublicMedia[] {
  const all = allMedia(site);
  const chosen = pkg.media_ids
    .map((id) => all.find((m) => m.id === id && m.kind === "image" && !!m.url))
    .filter((m): m is PublicMedia => !!m);
  if (chosen.length > 0) return chosen;
  const unit = packageUnit(pkg, site);
  const cover = unit ? unitCover(unit, site) : null;
  return cover ? [cover] : [];
}

/** התקופה לתצוגה ("5 בנובמבר 2026") — או null כשאין הגבלה */
export function packagePeriod(
  pkg: PublicPackage,
  locale = "he",
): { from: string | null; to: string | null } | null {
  if (!pkg.stay_from && !pkg.stay_to) return null;
  return {
    from: pkg.stay_from ? longDate(pkg.stay_from, locale) : null,
    to: pkg.stay_to ? longDate(pkg.stay_to, locale) : null,
  };
}

/** תאריך ההגעה הראשון שאפשר לבחור (היום, או תחילת התקופה) */
export function firstArrival(pkg: PublicPackage, today: string): string {
  return pkg.stay_from && pkg.stay_from > today ? pkg.stay_from : today;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
