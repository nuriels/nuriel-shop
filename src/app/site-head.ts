// שורש ההרכבה — נתוני ה-root ותגיות ה-meta לפי סוג האתר (R-1). חנות: getSiteSeo
// הקיים, בלי שינוי. אתר של מנוע אחר: רק מה שהמנוע מחזיר (באירוח — שם העסק), בלי
// אף שדה של החנות (מנוי, SEO, מעקב, שבת, מבצעים, לוגו). רק בחירה וחיבור.
import type { SiteType } from "@/platform/engines/contract";
import { hospitalitySiteHead } from "@/engines/hospitality/api/site.functions";
import { hospitalityHeadMeta } from "@/engines/hospitality/management/head";
import type { SiteHead } from "@/engines/hospitality/types/site";

export type EngineSite = { siteType: SiteType } & SiteHead;

/**
 * באתר של מנוע אחר — רק `engineSite`. שדות החנות (StoreData — מה-root) מוגדרים
 * undefined בטיפוס בלבד, כדי שרכיבי החנות הקיימים שקוראים את נתוני ה-root ימשיכו לעבור
 * בדיקת טיפוסים בלי שינוי (הם לא מוצגים באתרים האלה); בזמן ריצה אין באובייקט שום שדה כזה.
 */
export type EngineSiteData<StoreData> = { engineSite: EngineSite } & {
  [K in keyof StoreData]?: undefined;
};

export async function engineSiteData<StoreData>(
  siteType: SiteType,
): Promise<EngineSiteData<StoreData>> {
  if (siteType === "hospitality") {
    const head = await hospitalitySiteHead().catch(() => ({ name: null }));
    return { engineSite: { siteType, name: head.name } } as EngineSiteData<StoreData>;
  }
  return { engineSite: { siteType, name: null } } as EngineSiteData<StoreData>;
}

export function engineSiteMeta(site: EngineSite) {
  return hospitalityHeadMeta({ name: site.name });
}
