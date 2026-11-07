// זהות האתר לכותרות העמוד (R-1): באתר אירוח ה-root לא קורא את נתוני החנות.
// רק שם העסק, מ-hospitality.site_identity() (מיגרציה 9) — גם לגולש שלא מחובר
// (מסך הכניסה, קישור ששותף). כל תקלה → בלי שם (כותרת ניטרלית), לא נתוני חנות.
// A1: וגם מזהה הלוגו שהעסק העלה (אם יש) — לאייקון, לאייקון מסך הבית ולמניפסט של האתר.
import { createServerFn } from "@tanstack/react-start";
import type { SiteHead } from "../types/site";

async function currentLogoId(): Promise<string | null> {
  try {
    const { currentSite } = await import("@/platform/tenancy/current-site.server");
    const site = await currentSite();
    if (!site || site.siteType !== "hospitality") return null;
    const { siteLogoId } = await import("../website/brand.server");
    return await siteLogoId(site.id);
  } catch {
    return null;
  }
}

export const hospitalitySiteHead = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteHead> => {
    const { callRpc } = await import("../server/rpc.server");
    const logoId = await currentLogoId();
    try {
      const identity = await callRpc<{ name?: unknown } | null>("site_identity", {});
      const name = typeof identity?.name === "string" ? identity.name.trim() : "";
      return { name: name === "" ? null : name.slice(0, 120), logoId };
    } catch {
      return { name: null, logoId };
    }
  },
);
