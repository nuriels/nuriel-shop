// מנוע Hospitality — מממש את חוזה הפלטפורמה (plan B1). נטען גם בדפדפן (דרך
// שורש ההרכבה), ולכן כל קוד שרת נטען כאן רק בתוך הפונקציות (import דינמי).
import type { EdgeRequest, Engine, SiteRef } from "@/platform/engines/contract";
import { HOSPITALITY_SOURCE_PREFIX } from "./config";

export const hospitalityEngine: Engine = {
  key: "hospitality",
  label: "Nuriel Hospitality",
  ownsServerFn: (filename) => filename.startsWith(HOSPITALITY_SOURCE_PREFIX),
  async enabledFor(site: SiteRef) {
    const { backendEnabled } = await import("./access.server");
    return backendEnabled(site.id);
  },
  async gate(site: SiteRef, request: EdgeRequest) {
    const [{ hospitalityGate }, { managementEnabled }] = await Promise.all([
      import("./edge/gate"),
      import("./access.server"),
    ]);
    return hospitalityGate(site, request, { managementOpen: () => managementEnabled(site.id) });
  },
};
