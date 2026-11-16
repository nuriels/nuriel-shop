// מנוע אתרי העסקים (Nuriel Websites, ‏business_profile) — מממש את חוזה הפלטפורמה. נטען גם בדפדפן (דרך
// שורש ההרכבה), ולכן כל קוד שרת נטען כאן רק בתוך הפונקציות (import דינמי).
import type { EdgeRequest, Engine, SiteRef } from "@/platform/engines/contract";
import { BP_SOURCE_PREFIX } from "./config";

export const businessProfileEngine: Engine = {
  key: "business_profile",
  label: "Nuriel Websites",
  ownsServerFn: (filename) => filename.startsWith(BP_SOURCE_PREFIX),
  // פניות מלקוחות (מיגרציה 196): ניסיון חוזר להתראות במייל ומחיקה לפי מדיניות השמירה — רק בשרת,
  // ורק כשמתג המנוע דולק (נבדק בתוך התהליך)
  startWorkers() {
    if (typeof window !== "undefined") return;
    void import("./inquiries/worker.server").then((m) => m.startInquiryWorker());
  },
  // "אתרי אינטרנט" בפאנל הפלטפורמה — רק הקובץ הזה, ורק בכתובת הפאנל
  platformAdminServerFn: (filename) =>
    filename === `${BP_SOURCE_PREFIX}api/platform-admin.functions.ts`,
  async enabledFor(site: SiteRef) {
    const { studioEnabled } = await import("./access.server");
    return studioEnabled(site.id);
  },
  async gate(site: SiteRef, request: EdgeRequest) {
    const [{ businessProfileGate }, { siteEnabled, studioEnabled }] = await Promise.all([
      import("./edge/gate"),
      import("./access.server"),
    ]);
    return businessProfileGate(site, request, {
      hosts: async () =>
        (await import("@/platform/tenancy/current-site.server")).currentSiteHosts(),
      studioOpen: () => studioEnabled(site.id),
      siteOpen: () => siteEnabled(site.id),
      siteOrigin: async () => (await import("./data/seo.server")).canonicalSiteOrigin(),
      sitemap: async () => (await import("./data/seo.server")).sitemapResponse(site.id),
    });
  },
};
