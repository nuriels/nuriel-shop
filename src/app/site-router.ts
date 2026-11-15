// שורש ההרכבה — מיפוי הכתובות של הנתב לפי סוג האתר (Nuriel Websites, החלטה 1): רק באתר עסק
// (business_profile) "/x" ↔ "/bp-site/x"; בחנות, באתר אירוח ובפאנל — בלי מיפוי (בדיוק כמו היום).
import { businessProfileRewrite } from "@/engines/business-profile/edge/rewrite";
import { requestSiteTypeHint } from "@/platform/engines/site-type-hint";

export function engineRouterRewrite(): typeof businessProfileRewrite | undefined {
  return requestSiteTypeHint() === "business_profile" ? businessProfileRewrite : undefined;
}
