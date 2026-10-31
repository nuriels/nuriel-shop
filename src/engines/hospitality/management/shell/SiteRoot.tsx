// המעטפת של אתר אירוח מתחת ל-root (במקום השכבות של החנויות: סל, מצב שבת, פופ-אפ,
// מעקב). נבחרת ע"י שורש ההרכבה (src/app/site-shell.tsx).
import type { ReactNode } from "react";
import { Toaster } from "@/platform/ui";

export function HospitalitySiteRoot({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" dir="rtl" />
    </>
  );
}
