// שורש ההרכבה — המעטפת לפי סוג האתר (Stage 2a; הניווט לפי סוג האתר: site-routes.ts): אתר Ecommerce ממשיך עם השכבות
// הקיימות של ה-root; אתר אירוח מקבל את המעטפת של המנוע שלו. רק בחירה וחיבור.
import type { ReactNode } from "react";
import type { SiteType } from "@/platform/engines/contract";
import { HospitalitySiteRoot } from "@/engines/hospitality/management/shell/SiteRoot";

export function EngineSiteShell({
  siteType,
  children,
}: {
  siteType: SiteType;
  children: ReactNode;
}) {
  return siteType === "hospitality" ? (
    <HospitalitySiteRoot>{children}</HospitalitySiteRoot>
  ) : (
    children
  );
}
