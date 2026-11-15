// מסמך התחלתי לאתר חדש, לפי התבנית: מבנה דף נחיתה מלא (פתיח, אודות, שירותים, תיק עבודות, המלצות,
// קריאה לפעולה, יצירת קשר) עם ערכי התחלה ניטרליים — בעל העסק מחליף אותם בעורך.
import { BLOCK_DEFINITIONS, type BlockType } from "./blocks";
import { normalizeDocument } from "./normalize";
import type { SiteDocument, TemplateKey } from "./schema";
import { TEMPLATE_PALETTES } from "../templates/palettes";

const ORDER: Record<"elegant" | "portfolio", BlockType[]> = {
  elegant: ["hero", "about", "services", "portfolio", "testimonials", "cta", "contact"],
  portfolio: ["hero", "portfolio", "about", "services", "testimonials", "contact"],
};

export function initialDocument(template: TemplateKey, businessName: string): SiteDocument {
  const order = template === "portfolio" ? ORDER.portfolio : ORDER.elegant;
  const blocks = order.map((type) => {
    const props = BLOCK_DEFINITIONS[type].defaults() as unknown as Record<string, unknown>;
    if (type === "hero") props["title"] = { he: businessName };
    return { id: type, type, v: BLOCK_DEFINITIONS[type].version, hidden: false, props };
  });
  return normalizeDocument({
    template,
    locales: ["he"],
    theme: {
      palette: TEMPLATE_PALETTES[template === "portfolio" ? "portfolio" : "elegant"],
      radius: "soft",
    },
    business: { name: { he: businessName } },
    pages: [{ id: "home", slug: "", title: { he: businessName }, blocks }],
  });
}
