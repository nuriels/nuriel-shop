// הצעות SEO בסיסיות — בלי AI, בחינם, לכל עסק אירוח. טהור (נבדק ביחידה).
//
// נבנות רק מנתונים שהעסק כבר הזין ושמוצגים באתר: שם העסק, סוג המקום, היישוב (מהכתובת), היחידות — שם, סוג,
// קיבולת, חדרי שינה ורחצה, מתקנים. שום עובדה לא מומצאת: מה שאין בנתונים לא נכתב. בלי ביטויי חיפוש
// "מודבקים" — משפט טבעי אחד. ההצעות נשמרות כ"ממתינות" (seo_proposals) — ובהפקה האוטומטית המסד מכניס רק
// הצעות לשדות ריקים, כך שאף פעם לא מוצע לשנות משהו שהעסק כתב.
import type { PublicSite, PublicUnit } from "../types/website";
import { SEO_RECOMMENDED, type SeoProposalItem } from "../types/seo";
import { siteCopy } from "./copy";
import type { SiteDesign } from "./design/schema";

const t = siteCopy("he");

/** הכותרת הראשונה שנכנסת באורך — או null */
function fit(max: number, ...options: (string | null | undefined)[]): string | null {
  for (const o of options) {
    const s = o?.replace(/\s+/g, " ").trim();
    if (s && s.length <= max) return s;
  }
  return null;
}

/**
 * היישוב מתוך הכתובת החופשית: החלק הראשון (עד פסיק), בלי מספר בית. "מושב ישעי 22" → "מושב ישעי";
 * "רחוב הגפן 3, ראש פינה" → "ראש פינה" (כשהחלק הראשון נראה כמו רחוב). לא ברור — null (לא מנחשים).
 */
export function localityOf(address: string | null | undefined): string | null {
  const parts = (address ?? "")
    .split(/[,،\n]/)
    .map((p) =>
      p
        .replace(/\d+[א-ת]?/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => /[\p{L}]{2,}/u.test(p));
  if (!parts.length) return null;
  const street = /^(רחוב|רח'|שדרות|שד'|דרך|סמטת)\s/;
  const pick = street.test(parts[0]!) ? (parts[1] ?? null) : parts[0]!;
  return pick && pick.length <= 40 ? pick : null;
}

/** "ב" + שם היישוב ("במושב ישעי", "בראש פינה") */
const inPlace = (loc: string | null) => (loc ? `ב${loc}` : "");

function unitKindLabel(u: PublicUnit): string {
  if (u.kind === "whole_property") return "המתחם כולו";
  return t.unitTypes[u.unit_type ?? ""] || t.unitTypes["other"] || "יחידה";
}

const guests = (n: number) => (n === 1 ? "אורח אחד" : `עד ${n} אורחים`);
const rooms = (n: number | null | undefined, one: string, many: string) =>
  !n ? null : n === 1 ? one : `${n} ${many}`;

function unitFacts(u: PublicUnit): string[] {
  return [
    guests(u.capacity),
    rooms(u.bedrooms, "חדר שינה", "חדרי שינה"),
    rooms(u.bathrooms, "חדר רחצה", "חדרי רחצה"),
  ].filter((x): x is string => !!x);
}

export interface TemplateInput {
  site: Pick<PublicSite, "business" | "properties" | "units">;
  design: Pick<SiteDesign, "seo" | "sections">;
}

/** ההצעות הבסיסיות לעסק — לכל שדה רק אם יש מספיק נתונים אמיתיים */
export function templateProposals({ site }: TemplateInput): SeoProposalItem[] {
  const out: SeoProposalItem[] = [];
  const name = site.business.name.trim();
  if (!name) return out;
  const p = site.properties[0];
  const kind = (p?.property_type ? t.propertyTypes[p.property_type] : "") || "";
  const loc = localityOf(site.business.address) ?? localityOf(p?.address);
  const place = inPlace(loc);
  const stays = site.units.filter((u) => u.kind === "unit");
  const whole = site.units.find((u) => u.kind === "whole_property");

  // דף הבית
  const homeTitle = fit(
    SEO_RECOMMENDED.title,
    kind && place ? `${name} | ${kind} ${place}` : null,
    kind ? `${name} | ${kind}` : null,
    place ? `${name} | ${place}` : null,
  );
  if (homeTitle)
    out.push({ target_kind: "site", target_id: null, field: "seo_title", text: homeTitle });

  const what = [kind, place].filter(Boolean).join(" ");
  const count =
    stays.length === 0
      ? null
      : stays.length === 1
        ? "יחידת אירוח אחת"
        : `${stays.length} יחידות אירוח`;
  const homeDesc = fit(
    SEO_RECOMMENDED.description,
    what && count
      ? `${name} — ${what}: ${count}${whole ? ", ואפשר להזמין גם את כל המתחם" : ""}. בדקו זמינות והזמינו באתר.`
      : null,
    what && count ? `${name} — ${what}: ${count}. בדקו זמינות והזמינו באתר.` : null,
    what ? `${name} — ${what}. בדקו זמינות והזמינו באתר.` : null,
  );
  if (homeDesc)
    out.push({ target_kind: "site", target_id: null, field: "seo_description", text: homeDesc });

  // כותרת "על המקום" (H2): מה המקום ואיפה — רק כשיש גם סוג וגם יישוב
  if (kind && place)
    out.push({
      target_kind: "site",
      target_id: null,
      field: "about_title",
      text: `${kind} ${place}`,
    });

  // היחידות
  for (const u of site.units) {
    const label = unitKindLabel(u);
    const withName = (s: string) => (u.name.includes(name) ? s : `${s} | ${name}`);
    // "המתחם כולו" לא נכנס לכותרת (השם כבר אומר את זה); סוג היחידה — רק כשהוא לא חוזר על השם
    const typed = u.kind === "unit" && !u.name.includes(label) ? `${label}, ` : "";
    const title = fit(
      SEO_RECOMMENDED.title,
      withName(`${u.name} – ${typed}${guests(u.capacity)}`),
      withName(`${u.name} – ${guests(u.capacity)}`),
      withName(u.name),
      u.name,
    );
    if (title) out.push({ target_kind: "unit", target_id: u.id, field: "seo_title", text: title });

    const facts = unitFacts(u).join(", ");
    const amenities = u.amenities
      .map((a) => a.name.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const at = `ב${name}${loc ? `, ${loc}` : ""}`;
    const desc = fit(
      SEO_RECOMMENDED.description,
      amenities ? `${u.name} ${at}: ${label}, ${facts}. ${amenities}.` : null,
      `${u.name} ${at}: ${label}, ${facts}.`,
      `${u.name} ${at}: ${facts}.`,
    );
    if (desc)
      out.push({ target_kind: "unit", target_id: u.id, field: "seo_description", text: desc });
  }
  return out;
}
