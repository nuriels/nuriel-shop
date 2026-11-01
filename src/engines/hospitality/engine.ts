// מנוע Hospitality — מממש את חוזה הפלטפורמה (plan B1). נטען גם בדפדפן (דרך
// שורש ההרכבה), ולכן כל קוד שרת נטען כאן רק בתוך הפונקציות (import דינמי).
import type { EdgeRequest, Engine, SiteRef } from "@/platform/engines/contract";
import { HOSPITALITY_SOURCE_PREFIX } from "./config";

export const hospitalityEngine: Engine = {
  key: "hospitality",
  label: "Nuriel Hospitality",
  ownsServerFn: (filename) => filename.startsWith(HOSPITALITY_SOURCE_PREFIX),
  // "ניהול Hospitality" בפאנל הפלטפורמה — רק הקובץ הזה, ורק בכתובת הפאנל
  platformAdminServerFn: (filename) =>
    filename === `${HOSPITALITY_SOURCE_PREFIX}api/platform-admin.functions.ts`,
  // תור המיילים ותפוגת בקשות (2k) — בשרת בלבד, ורק כשמתג הסביבה דולק (נבדק בתוך ה-worker)
  startWorkers() {
    if (typeof window !== "undefined") return;
    void import("./outbox/worker.server").then((m) => m.startOutboxWorker());
  },
  async enabledFor(site: SiteRef) {
    const { backendEnabled } = await import("./access.server");
    return backendEnabled(site.id);
  },
  async gate(site: SiteRef, request: EdgeRequest) {
    const [{ hospitalityGate }, { managementEnabled, siteEnabled }] = await Promise.all([
      import("./edge/gate"),
      import("./access.server"),
    ]);
    return hospitalityGate(site, request, {
      managementOpen: () => managementEnabled(site.id),
      siteOpen: () => siteEnabled(site.id),
    });
  },
};
