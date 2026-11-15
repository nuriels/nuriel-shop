// המעטפת של אתר עסק ב-root: בלי הסל, מצב שבת, פופ-אפ ומעקב של החנויות. ההודעות הקופצות (Toaster) — לממשק
// הניהול.
import type { ReactNode } from "react";
import { Toaster } from "@/platform/ui";

export function BusinessSiteRoot({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" dir="rtl" />
    </>
  );
}
