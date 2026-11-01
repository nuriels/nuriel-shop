// ההגדרות של נתיבי האתר הציבורי (/stay) — מתאמי הנתיבים ב-src/routes רק מעבירים אותן.
// נתוני האתר נטענים פעם אחת במעטפת (SSR) ומשותפים לכל העמודים; עמוד יחידה שלא קיים → 404.
import { notFound } from "@tanstack/react-router";
import { hospitalityPublicSite } from "../api/website.functions";
import { hospitalitySiteOnly } from "../management/route-guard";
import type { PublicSite } from "../types/website";
import { siteHomeMeta, siteUnitMeta } from "./head";
import { HomePage } from "./pages/HomePage";
import { SiteError, SiteNotFound } from "./pages/SiteMessage";
import { UnitPage } from "./pages/UnitPage";
import { findUnit } from "./lib/format";
import { SiteLayout } from "./SiteLayout";

type ParentMatch = Promise<{ loaderData?: unknown }>;

export const siteLayoutRoute = {
  beforeLoad: hospitalitySiteOnly,
  loader: (): Promise<PublicSite> => hospitalityPublicSite(),
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
