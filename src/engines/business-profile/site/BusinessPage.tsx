// עמוד באתר העסק (מהגרסה המפורסמת) + הכותרות שלו — לשימוש מתאמי הנתיבים (src/routes/bp-site.*)
import { notFound } from "@tanstack/react-router";
import { pageBySlug } from "../document/normalize";
import type { PublicSiteData } from "../types";
import {
  BP_CREDIT_AFTER,
  BP_CREDIT_BEFORE,
  BP_CREDIT_LABEL,
  BP_PRODUCT,
  NURIEL_CREDIT_REL,
  NURIEL_CREDIT_URL,
} from "./credit";
import { pageHead } from "./page-head";
import { SiteView } from "./SiteView";

export function BusinessPage({ site, slug }: { site: PublicSiteData; slug: string }) {
  const page = pageBySlug(site.document, slug);
  if (!page) return <BusinessNotFound />;
  return <SiteView doc={site.document} media={site.media} page={page} />;
}

/** עמוד שלא קיים בגרסה המפורסמת → 404 (נזרק ב-loader, כך שגם ה-SSR מחזיר 404) */
export function requirePage(site: PublicSiteData | undefined, slug: string): null {
  if (!site || !/^[a-z0-9-]{1,63}$/.test(slug) || !pageBySlug(site.document, slug))
    throw notFound();
  return null;
}

/** "העמוד לא נמצא" באתר עסק — בעברית, עם קישור לדף הבית והקרדיט (לא עמוד ה-404 הכללי) */
export function BusinessNotFound() {
  return (
    <main
      id="main-content"
      dir="rtl"
      lang="he"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "4rem 1.5rem",
        textAlign: "center",
        background: "#f8f6f2",
        color: "#26221e",
        fontFamily: "Assistant, Heebo, system-ui, sans-serif",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: "1.9rem", fontWeight: 600 }}>העמוד לא נמצא</h1>
        <p style={{ margin: "1rem 0 2rem", color: "#5a5249" }}>
          ייתכן שהקישור השתנה או שהעמוד הוסר.
        </p>
        <a
          href="/"
          style={{
            display: "inline-flex",
            minHeight: "2.75rem",
            alignItems: "center",
            padding: "0 1.5rem",
            borderRadius: 999,
            background: "#26221e",
            color: "#f8f6f2",
            textDecoration: "none",
          }}
        >
          לדף הבית
        </a>
        <p style={{ marginTop: "3rem", fontSize: ".78rem", color: "#5a5249" }}>
          <a
            href={NURIEL_CREDIT_URL}
            target="_blank"
            rel={NURIEL_CREDIT_REL}
            aria-label={BP_CREDIT_LABEL}
            style={{ color: "inherit" }}
          >
            {BP_CREDIT_BEFORE}
            <bdi>{BP_PRODUCT}</bdi>
            {BP_CREDIT_AFTER}
          </a>
        </p>
      </div>
    </main>
  );
}

/** הכותרות של העמוד — מנתוני מקטע האתר (ה-loader של /bp-site) */
export function businessPageHead(
  matches: readonly { routeId: string; loaderData?: unknown }[],
  slug: string,
) {
  const site = matches.find((m) => m.routeId === "/bp-site")?.loaderData as
    PublicSiteData | undefined;
  const page = site ? pageBySlug(site.document, slug) : null;
  return site && page
    ? pageHead(site, page)
    : { meta: [{ title: "העמוד לא נמצא" }, { name: "robots", content: "noindex" }] };
}
