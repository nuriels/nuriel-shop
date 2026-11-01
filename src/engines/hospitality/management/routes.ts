// הגדרות הנתיבים של אזור הניהול (המעטפת וכניסה) — המתאמים ב-src/routes רק מחברים אותן.
// כולל כותרות האבטחה (security/headers.ts): בלי מסגור מאתרים אחרים, בלי מטמון.
import { MANAGE_SECURITY_HEADERS } from "../security/headers";
import { ManageLogin } from "./login/ManageLogin";
import { hospitalitySiteOnly } from "./route-guard";
import { ManageLayout } from "./shell/ManageLayout";

const noindex = (title: string) => ({
  meta: [{ title }, { name: "robots", content: "noindex, nofollow" }],
});

export const manageLayoutRoute = {
  ssr: "data-only" as const,
  beforeLoad: hospitalitySiteOnly,
  head: () => noindex("ניהול העסק"),
  headers: () => MANAGE_SECURITY_HEADERS,
  component: ManageLayout,
};

/** הכניסה — מחוץ למעטפת (בלי בדיקת הרשאה) */
export const manageLoginRoute = {
  ssr: "data-only" as const,
  beforeLoad: hospitalitySiteOnly,
  head: () => noindex("כניסה לניהול העסק"),
  headers: () => MANAGE_SECURITY_HEADERS,
  component: ManageLogin,
};
