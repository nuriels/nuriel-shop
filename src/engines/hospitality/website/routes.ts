// ההגדרות של נתיבי האתר הציבורי (/stay) — מתאמי הנתיבים ב-src/routes רק מעבירים אותן.
// נתוני האתר נטענים פעם אחת במעטפת (SSR) ומשותפים לכל העמודים; עמוד יחידה שלא קיים → 404.
import { notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { hospitalityPublicSite } from "../api/website.functions";
import { hospitalitySiteOnly } from "../management/route-guard";
import { MANAGE_SECURITY_HEADERS, SITE_SECURITY_HEADERS } from "../security/headers";
import type { PublicSite } from "../types/website";
import { privatePageMeta, siteHomeMeta, siteUnitMeta } from "./head";
import { validateBookSearch } from "./lib/booking";
import { BookingPage } from "./pages/BookingPage";
import { BookingReceivedPage, MyBookingPage } from "./pages/GuestBookingPages";
import { HomePage } from "./pages/HomePage";
import { PreviewPage } from "./pages/PreviewPage";
import { AccessibilityPage, PrivacyPage } from "./pages/LegalPages";
import { SiteError, SiteNotFound } from "./pages/SiteMessage";
import { UnitPage } from "./pages/UnitPage";
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
  head: ({ matches }: { matches: { routeId: string; loaderData?: unknown }[] }) => ({
    meta: siteHomeMeta(
      matches.find((m) => m.routeId === "/stay")?.loaderData as PublicSite | undefined,
    ),
  }),
  component: HomePage,
};

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
    return { meta: siteUnitMeta(site, unit) };
  },
  head: ({ loaderData }: { loaderData?: { meta: ReturnType<typeof siteUnitMeta> } }) => ({
    meta: loaderData?.meta ?? [],
  }),
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
    const meta = siteUnitMeta(site, {
      ...type.lead,
      name: type.type.name,
      description: type.type.description ?? type.lead.description,
      seo_title: null,
      seo_description: null,
    });
    return { meta };
  },
  head: ({ loaderData }: { loaderData?: { meta: ReturnType<typeof siteUnitMeta> } }) => ({
    meta: loaderData?.meta ?? [],
  }),
  component: UnitPage,
  notFoundComponent: SiteNotFound,
};
