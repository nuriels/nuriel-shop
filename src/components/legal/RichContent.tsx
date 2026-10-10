import { useMemo } from "react";
import { richContentHtml } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * הצגת טקסט עשיר שנשמר בפאנל (תקנון, פרטיות, מדיניות ביטולים, אודות).
 * התוכן תמיד עובר ניקוי (DOMPurify, רשימה סגורה) — גם תוכן ישן בטקסט רגיל
 * מוצג נכון (פסקאות ושורות).
 */
export function RichContent({
  content,
  className,
  variant = "default",
}: {
  content: string | null | undefined;
  className?: string;
  /** document — מסמך ארוך (תקנון, פרטיות, ביטולים): טקסט מלא בגודל קריא, כותרות ורווחים */
  variant?: "default" | "document";
}) {
  const html = useMemo(() => richContentHtml(content), [content]);
  if (html === "") return null;
  return (
    <div
      className={cn(
        "rich-content text-sm text-foreground sm:text-base",
        variant === "document" && "legal-document max-w-none",
        className,
      )}
      {...(variant === "document" ? { "data-testid": "legal-document" } : {})}
      // מנוקה ב-sanitizeRichHtml (src/lib/rich-text.ts)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
