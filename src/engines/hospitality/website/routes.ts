// ההגדרות של נתיבי האתר הציבורי (/stay) — מתאמי הנתיבים ב-src/routes רק מעבירים אותן.
// נתוני האתר נטענים פעם אחת במעטפת (SSR) ומשותפים לכל העמודים; עמוד יחידה שלא קיים → 404.
import { notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { hospitalityPublicSite } from "../api/website.functions";
import { hospitalitySiteOnly } from "../management/route-guard";
import { MANAGE_SECURITY_HEADERS, SITE_SECURITY_HEADERS } from "../security/headers";
import type { PublicSite } from "../types/website";
import { SITE_PATH } from "../config";
import { privatePageMeta, siteHomeHead, siteUnitHead, type PageHead } from "./head";
import { validateBookSearch } from "./lib/booking";
import { BookingPage } from "./pages/BookingPage";
import { GuestAreaPage } from "./pages/GuestAreaPage";
import { BookingReceivedPage, MyBookingPage } from "./pages/GuestBookingPages";
import { HomePage } from "./pages/HomePage";
import { PreviewPage } from "./pages/PreviewPage";
import { AccessibilityPage, PrivacyPage } from "./pages/LegalPages";
import { SiteError, SiteNotFound } from "./pages/SiteMessage";
import { UnitPage } from "./pages/UnitPage";
import { PackagePage } from "./pages/PackagePage";
import { findPackage, packageImages, packageUnit } from "./lib/packages";
import { findUnit } from "./lib/format";
import { findType } from "./lib/listing";
import { SiteLayout } from "./SiteLayout";

type ParentMatch = Promise<{ loaderData?: unknown }>;

export const siteLayoutRoute = {
  beforeLoad: hospitalitySiteOnly,
  // כותרות אבטחה לכל עמודי האתר (security/headers.ts)
  headers: () => SITE_SECURITY_HEADERS,
  // אתר שנסגר (הדגל כבוי, או עוד לא פתוח) → 404 "האתר עדיין לא פתוח", לא שגיאת שרת
  loader: async (): Promise<PublicSite> => {
    try {
      return await hospitalityPublicSite();
    } catch (e) {
      if (e instanceof Error && e.message.includes("לא פתוח"))
        throw notFound({ data: { closed: true } });
      throw e;
    }
  },
  // ניווט בין עמודי האתר — בלי לטעון שוב (הזמינות והמחיר נבדקים בנפרד, בזמן אמת)
  staleTime: 5 * 60_000,
  component: SiteLayout,
  errorComponent: SiteError,
  notFoundComponent: SiteNotFound,
};

export const siteHomeRoute = {
  head: ({ matches }: { matches: { routeId: string; loaderData?: unknown }[] }) =>
    siteHomeHead(matches.find((m) => m.routeId === "/stay")?.loaderData as PublicSite | undefined),
  component: HomePage,
};

const seg = (slug: string) => encodeURIComponent(slug);

export const siteUnitRoute = {
  loader: async ({
    params,
    parentMatchPromise,
  }: {
    params: { unitSlug: string };
    parentMatchPromise: ParentMatch;
  }) => {
    const site = (await parentMatchPromise).loaderData as PublicSite | undefined;
    const unit = site ? findUnit(site.units, params.unitSlug) : undefined;
    if (!site || !unit) throw notFound();
    // חדר ששייך לסוג (מלון) — העמוד הקנוני הוא עמוד הסוג (בלי תוכן כפול בגוגל)
    const type = (site.room_types ?? []).find((t) => t.room_ids.includes(unit.id));
    const path = type
      ? `${SITE_PATH}/rooms/${seg(type.slug)}`
      : `${SITE_PATH}/units/${seg(unit.slug)}`;
    return { head: siteUnitHead(site, unit, path) };
  },
  head: ({ loaderData }: { loaderData?: { head: PageHead } }) =>
    loaderData?.head ?? { meta: [], links: [] },
  component: UnitPage,
  notFoundComponent: SiteNotFound,
};

type HeadContext = { matches: { routeId: string; loaderData?: unknown }[] };
const parentSite = (ctx: HeadContext) =>
  ctx.matches.find((m) => m.routeId === "/stay")?.loaderData as PublicSite | undefined;

/** עמוד פרטי של האתר (הזמנה, ניהול ההזמנה, טיוטות) — בלי אינדוקס */
function privateRoute(title: string, component: () => ReactNode) {
  return {
    head: (ctx: HeadContext) => ({ meta: privatePageMeta(title, parentSite(ctx)) }),
    component,
  };
}

export const siteBookRoute = {
  ...privateRoute("הזמנת שהייה", BookingPage),
  validateSearch: validateBookSearch,
};
export const siteReceivedRoute = privateRoute("הבקשה התקבלה", BookingReceivedPage);
export const siteMyBookingRoute = privateRoute("ההזמנה שלי", MyBookingPage);
/** שלב א' 2: "ההזמנות שלי" — כניסה בקוד למייל; ?booking=<id> — הזמנה אחת */
export const siteAccountRoute = {
  ...privateRoute("ההזמנות שלי", GuestAreaPage),
  validateSearch: (raw: Record<string, unknown>): { booking?: string } =>
    typeof raw["booking"] === "string" && /^[0-9a-f-]{36}$/i.test(raw["booking"])
      ? { booking: raw["booking"].toLowerCase() }
      : {},
};
export const sitePrivacyRoute = privateRoute("מדיניות פרטיות", PrivacyPage);
export const siteAccessibilityRoute = privateRoute("הצהרת נגישות", AccessibilityPage);

/** התצוגה המקדימה של העורך (/manage/preview) — רק באתר אירוח, לצוות המחובר; בלי אינדוקס */
export const sitePreviewRoute = {
  beforeLoad: hospitalitySiteOnly,
  headers: () => MANAGE_SECURITY_HEADERS,
  ssr: false as const,
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(raw["page"] === "unit" ? { page: "unit" as const } : {}),
    ...(typeof raw["unit"] === "string" && raw["unit"].length <= 200 ? { unit: raw["unit"] } : {}),
  }),
  head: () => ({
    meta: [{ title: "תצוגה מקדימה" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: PreviewPage,
};

/** עמוד סוג חדר (מלון): /stay/rooms/<slug> — אותו עמוד כמו יחידה, לפי הסוג */
export const siteRoomTypeRoute = {
  loader: async ({
    params,
    parentMatchPromise,
  }: {
    params: { typeSlug: string };
    parentMatchPromise: ParentMatch;
  }) => {
    const site = (await parentMatchPromise).loaderData as PublicSite | undefined;
    const type = site ? findType(site, params.typeSlug) : undefined;
    if (!site || !type) throw notFound();
    const head = siteUnitHead(
      site,
      {
        ...type.lead,
        name: type.type.name,
        description: type.type.description ?? type.lead.description,
        seo_title: null,
        seo_description: null,
      },
      `${SITE_PATH}/rooms/${seg(type.type.slug)}`,
    );
    return { head };
  },
  head: ({ loaderData }: { loaderData?: { head: PageHead } }) =>
    loaderData?.head ?? { meta: [], links: [] },
  component: UnitPage,
  notFoundComponent: SiteNotFound,
};

/** שלב א' 7: עמוד חבילה: /stay/packages/<slug> — חבילה שמוצגת באתר; אחרת 404 */
export const sitePackageRoute = {
  loader: async ({
    params,
    parentMatchPromise,
  }: {
    params: { packageSlug: string };
    parentMatchPromise: ParentMatch;
  }) => {
    const site = (await parentMatchPromise).loaderData as PublicSite | undefined;
    const pkg = site ? findPackage(site, params.packageSlug) : undefined;
    const unit = site && pkg ? packageUnit(pkg, site) : undefined;
    if (!site || !pkg || !unit) throw notFound();
    // הכותרות לשיתוף: שם החבילה, התיאור והתמונה הראשונה שלה (או של היחידה)
    const head = siteUnitHead(
      site,
      {
        ...unit,
        name: pkg.name,
        description: pkg.description ?? unit.description,
        seo_title: null,
        seo_description: null,
        media: packageImages(pkg, site),
      },
      `${SITE_PATH}/packages/${seg(pkg.slug)}`,
    );
    return { head };
  },
  head: ({ loaderData }: { loaderData?: { head: PageHead } }) =>
    loaderData?.head ?? { meta: [], links: [] },
  component: PackagePage,
  notFoundComponent: SiteNotFound,
};
