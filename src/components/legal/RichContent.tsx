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
}: {
  content: string | null | undefined;
  className?: string;
}) {
  const html = useMemo(() => richContentHtml(content), [content]);
  if (html === "") return null;
  return (
    <div
      className={cn("rich-content text-sm text-foreground sm:text-base", className)}
      // מנוקה ב-sanitizeRichHtml (src/lib/rich-text.ts)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
