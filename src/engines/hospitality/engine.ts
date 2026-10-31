// מנוע Hospitality — מממש את חוזה הפלטפורמה (plan B1). נטען גם בדפדפן (דרך
// שורש ההרכבה), ולכן כל קוד שרת נטען כאן רק בתוך הפונקציות (import דינמי).
import type { EdgeRequest, Engine, SiteRef } from "@/platform/engines/contract";
import { HOSPITALITY_FLAGS, HOSPITALITY_SOURCE_PREFIX, hospitalitySwitchOn } from "./config";

export const hospitalityEngine: Engine = {
  key: "hospitality",
  label: "Nuriel Hospitality",
  ownsServerFn: (filename) => filename.startsWith(HOSPITALITY_SOURCE_PREFIX),
  async enabledFor(site: SiteRef) {
    if (!hospitalitySwitchOn()) return false;
    const { featureEnabled } = await import("@/platform/feature-flags/flags.server");
    return featureEnabled(HOSPITALITY_FLAGS.backend, site.id);
  },
  async gate(site: SiteRef, request: EdgeRequest) {
    const { hospitalityGate } = await import("./edge/gate");
    return hospitalityGate(site, request);
  },
};
