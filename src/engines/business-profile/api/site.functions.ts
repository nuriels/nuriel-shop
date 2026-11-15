// האתר הציבורי של עסק: שם העסק לכותרות (ה-root), והגרסה המפורסמת לעמודים. רצות רק באתר עסק שהמנוע
// פעיל בו (engine-guard); המסד מחזיר תוכן רק לגרסה שאושרה ופורסמה.
import { createServerFn } from "@tanstack/react-start";
import type { PublicSiteData } from "../types";

export const businessSiteHead = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ name: string | null }> => {
    const { siteRpc } = await import("../data/rpc.server");
    try {
      const head = await siteRpc<{ name?: unknown } | null>("bp_site_head", {});
      const name = typeof head?.name === "string" ? head.name.trim().slice(0, 120) : "";
      return { name: name || null };
    } catch {
      return { name: null };
    }
  },
);

export const businessPublicSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSiteData | null> => {
    const [{ loadPublicSite }, { canonicalSiteOrigin }] = await Promise.all([
      import("../data/public-site.server"),
      import("../data/seo.server"),
    ]);
    const site = await loadPublicSite();
    if (!site) return null;
    return { ...site, origin: await canonicalSiteOrigin().catch(() => null) };
  },
);
