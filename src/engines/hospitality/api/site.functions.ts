// זהות האתר לכותרות העמוד (R-1): באתר אירוח ה-root לא קורא את נתוני החנות.
// רק שם העסק, מ-hospitality.site_identity() (מיגרציה 9) — גם לגולש שלא מחובר
// (מסך הכניסה, קישור ששותף). כל תקלה → בלי שם (כותרת ניטרלית), לא נתוני חנות.
import { createServerFn } from "@tanstack/react-start";
import type { SiteHead } from "../types/site";

export const hospitalitySiteHead = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteHead> => {
    const { callRpc } = await import("../server/rpc.server");
    try {
      const identity = await callRpc<{ name?: unknown } | null>("site_identity", {});
      const name = typeof identity?.name === "string" ? identity.name.trim() : "";
      return { name: name === "" ? null : name.slice(0, 120) };
    } catch {
      return { name: null };
    }
  },
);
