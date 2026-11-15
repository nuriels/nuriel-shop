// הכותרות של עמוד באתר העסק: כותרת ותיאור (מהגדרות העמוד, אחרת מפרטי העסק), כתובת קנונית ו-Open Graph.
// טהור (נבדק ביחידה).
import { tx } from "../document/normalize";
import type { Page } from "../document/schema";
import type { PublicSiteData } from "../types";
import siteCss from "./site.css?url";

export const SITE_STYLE_LINKS = [
  { rel: "stylesheet", href: "/fonts/bp/websites.css" },
  { rel: "stylesheet", href: siteCss },
];

export function pageHead(site: PublicSiteData, page: Page) {
  const doc = site.document;
  const name = tx(doc.business.name) || site.name;
  const pageTitle = tx(page.seo.title) || (page.slug ? `${tx(page.title)} | ${name}` : name);
  const description = tx(page.seo.description) || tx(doc.business.tagline) || name;
  const canonical = site.origin ? `${site.origin}/${page.slug ? encodeURI(page.slug) : ""}` : null;
  return {
    meta: [
      { title: pageTitle },
      { name: "description", content: description },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: description },
      { property: "og:site_name", content: name },
      ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    ],
    links: [...SITE_STYLE_LINKS, ...(canonical ? [{ rel: "canonical", href: canonical }] : [])],
  };
}
