// הגדרות הנתיבים של אזור הניהול (המעטפת וכניסה) — המתאמים ב-src/routes רק מחברים אותן.
// כולל כותרות האבטחה (security/headers.ts): בלי מסגור מאתרים אחרים, בלי מטמון.
// עיצוב (שלב F2): הגיליון של אזור הניהול ("Deep Lagoon & Champagne") נטען רק בנתיבים האלה.
import { MANAGE_SECURITY_HEADERS } from "../security/headers";
import { ManageLogin } from "./login/ManageLogin";
import { hospitalitySiteOnly } from "./route-guard";
import { ManageLayout } from "./shell/ManageLayout";
import { ManageNotFound } from "./shell/StatusScreens";
import manageCss from "./styles/manage.css?url";

const noindex = (title: string) => ({
  meta: [{ title }, { name: "robots", content: "noindex, nofollow" }],
  links: [{ rel: "stylesheet", href: manageCss }],
});

export const manageLayoutRoute = {
  ssr: "data-only" as const,
  beforeLoad: hospitalitySiteOnly,
  head: () => noindex("ניהול העסק"),
  headers: () => MANAGE_SECURITY_HEADERS,
  component: ManageLayout,
  // F2b: כתובת לא מוכרת בתוך /manage — בעברית ובתוך המעטפת (לא עמוד ה-404 הכללי)
  notFoundComponent: ManageNotFound,
};

/** הכניסה — מחוץ למעטפת (בלי בדיקת הרשאה) */
export const manageLoginRoute = {
  ssr: "data-only" as const,
  beforeLoad: hospitalitySiteOnly,
  head: () => noindex("כניסה לניהול העסק"),
  headers: () => MANAGE_SECURITY_HEADERS,
  component: ManageLogin,
};
