// llms.txt של אתר אירוח — טהור (נבדק ביחידה). רק מה שהאתר עצמו מציג לכל גולש (public_site): שם, תיאור,
// כתובת ודרכי קשר, שעות כניסה ויציאה, היחידות והחבילות. בלי מחירים (משתנים), בלי זמינות, בלי שום דבר
// מהניהול. מוגש רק כשהאתר פתוח לציבור (השער, כמו מפת האתר).
// רק עמודים שסורק רשאי לקרוא: המסמכים (/stay/docs, פרטיות, נגישות) הם עמודים פרטיים בכוונה (noindex +
// חסומים ב-robots.txt, seo.ts) — לכן הם לא ברשימה; העובדות שהאורח צריך (שעות, אופן ההזמנה, שבת) כן.
import { renderLlms, type LlmsLink } from "@/platform/seo/llms";
import { SITE_PATH } from "../config";
import type { PublicSite, PublicUnit } from "../types/website";
import { siteListing } from "./lib/listing";
import { sitePackages } from "./lib/packages";
import { siteSeo } from "./seo";

const seg = (slug: string) => encodeURIComponent(slug);
const time = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

function unitNote(unit: PublicUnit): string | null {
  const parts = [
    unit.capacity > 0 ? `עד ${unit.capacity} אורחים` : null,
    unit.bedrooms ? `${unit.bedrooms} חדרי שינה` : null,
    unit.size_sqm ? `${unit.size_sqm} מ"ר` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function siteLlmsTxt(site: PublicSite, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  const b = site.business;
  const property = site.properties[0] ?? null;
  const units: LlmsLink[] = siteListing(site).map((item) =>
    item.kind === "unit"
      ? {
          title: item.unit.name,
          url: `${base}${SITE_PATH}/units/${seg(item.unit.slug)}`,
          note: unitNote(item.unit),
        }
      : {
          title: item.type.type.name,
          url: `${base}${SITE_PATH}/rooms/${seg(item.type.type.slug)}`,
          note: item.type.rooms.length > 1 ? `${item.type.rooms.length} חדרים מהסוג` : null,
        },
  );
  const packages: LlmsLink[] = sitePackages(site).map((p) => ({
    title: p.name,
    url: `${base}${SITE_PATH}/packages/${seg(p.slug)}`,
    note: p.nights > 0 ? `${p.nights} לילות` : null,
  }));
  return renderLlms({
    name: b.name,
    summary: siteSeo(site).description || property?.description,
    facts: [
      ["כתובת", b.address || property?.address],
      ["טלפון", b.phone],
      ["וואטסאפ", b.whatsapp],
      ["אימייל", b.email],
      ["שעת כניסה", time(b.check_in_time)],
      ["שעת יציאה", time(b.check_out_time)],
      [
        "הזמנה",
        site.booking_open
          ? b.booking_mode === "instant"
            ? "הזמנה באתר"
            : "בקשת הזמנה באתר — בעל המקום מאשר"
          : null,
      ],
      ["שבת", b.shabbat_observant ? "המתחם שומר שבת" : null],
    ],
    sections: [
      { title: "דף הבית", links: [{ title: b.name, url: `${base}${SITE_PATH}` }] },
      { title: "יחידות האירוח", links: units },
      { title: "חבילות", links: packages },
    ],
    sitemap: `${base}/sitemap.xml`,
  });
}
