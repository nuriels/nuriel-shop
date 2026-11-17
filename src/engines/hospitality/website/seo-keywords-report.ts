// הדוח של ביטויי החיפוש לפי הטיוטה בעורך — אותן פונקציות שבונות את כותרות האתר (siteHomeHead /
// siteUnitHead), עם מסמך הטיוטה במקום הגרסה המפורסמת. טהור, נבדק ביחידה. בקובץ נפרד מ-seo-keywords.ts
// כי schema.ts מייבא את seo-keywords.ts, ו-head.ts מייבא את schema.ts.
import type { PublicSite } from "../types/website";
import type { SiteDesign } from "./design/schema";
import { siteHomeHead, siteUnitHead } from "./head";
import { homeTexts, keywordReport, stuffingWarnings, unitTexts } from "./seo-keywords";

const metaValue = (meta: Record<string, string>[], key: "title" | "description") => {
  const m = meta.find((x) => (key === "title" ? "title" in x : x["name"] === key));
  return (key === "title" ? m?.["title"] : m?.["content"]) ?? "";
};

/** הדוח לפי הטיוטה: אותן פונקציות שבונות את כותרות האתר, עם מסמך הטיוטה */
export function draftKeywordReport(site: PublicSite, design: SiteDesign) {
  const keywords = design.seo?.keywords ?? [];
  const draft: PublicSite = {
    ...site,
    design: {
      kind: "draft",
      version: site.design?.version ?? 0,
      revision: site.design?.revision ?? 0,
      updated_at: site.design?.updated_at ?? "",
      theme: design.theme,
      document: JSON.stringify(design),
    },
  };
  const homeMeta = siteHomeHead(draft).meta;
  const home = {
    title: metaValue(homeMeta, "title"),
    description: metaValue(homeMeta, "description"),
  };
  const units = site.units.map((unit) => {
    const meta = siteUnitHead(draft, unit, "").meta;
    return {
      unit,
      texts: unitTexts(unit, {
        title: metaValue(meta, "title"),
        description: metaValue(meta, "description"),
      }),
    };
  });
  return {
    home,
    rows: keywordReport(keywords, homeTexts(site, home, design.sections), units),
    warnings: stuffingWarnings(home.title, home.description, keywords),
  };
}
