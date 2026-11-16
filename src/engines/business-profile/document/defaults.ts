// מסמך התחלתי לאתר חדש, לפי התבנית: מבנה דף נחיתה מלא (פתיח, אודות, שירותים, תיק עבודות, המלצות,
// קריאה לפעולה, יצירת קשר) עם ערכי התחלה ניטרליים — בעל העסק מחליף אותם בעורך.
import { BLOCK_DEFINITIONS, type BlockType } from "./blocks";
import { normalizeDocument } from "./normalize";
import type { SiteDocument, TemplateKey } from "./schema";
import { TEMPLATE_PALETTES } from "../templates/palettes";

const ORDER: Record<"elegant" | "portfolio" | "classic", BlockType[]> = {
  elegant: ["hero", "about", "services", "portfolio", "testimonials", "cta", "contact"],
  portfolio: ["hero", "portfolio", "about", "services", "testimonials", "contact"],
  classic: ["hero", "form", "about", "testimonials", "services", "portfolio", "form"],
};
const paletteKey = (t: TemplateKey) => (t === "portfolio" || t === "classic" ? t : "elegant");

export function initialDocument(template: TemplateKey, businessName: string): SiteDocument {
  const order = ORDER[paletteKey(template)];
  const taken = new Set<string>();
  const blocks = order.map((type) => {
    const props = BLOCK_DEFINITIONS[type].defaults() as unknown as Record<string, unknown>;
    if (type === "hero") props["title"] = { he: businessName };
    let id: string = type;
    for (let n = 2; taken.has(id); n++) id = `${type}-${n}`;
    taken.add(id);
    return { id, type, v: BLOCK_DEFINITIONS[type].version, hidden: false, props };
  });
  return normalizeDocument({
    template,
    locales: ["he"],
    theme: {
      palette: TEMPLATE_PALETTES[paletteKey(template)],
      radius: "soft",
      ...(template === "classic"
        ? { chrome: { header: "none", footer: "strip", floatingWhatsapp: false } }
        : {}),
    },
    business: { name: { he: businessName } },
    pages: [{ id: "home", slug: "", title: { he: businessName }, blocks }],
  });
}
