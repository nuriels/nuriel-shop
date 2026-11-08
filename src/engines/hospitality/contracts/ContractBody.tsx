// הנוסח המלא של החוזה (בלוקים → טקסט קריא, מימין לשמאל). שדות שעוד לא מולאו ("________") מודגשים.
// הכל טקסט — בלי HTML מהמסד (שום dangerouslySetInnerHTML).
import type { ReactNode } from "react";
import { cn } from "@/platform/ui";
import { BLANK, contractBlocks } from "./blocks";

function withBlanks(text: string, highlight: boolean): ReactNode {
  if (!highlight || !text.includes(BLANK)) return text;
  const parts = text.split(BLANK);
  return parts.flatMap((p, i) =>
    i === 0
      ? [p]
      : [
          <mark key={i} className="rounded bg-amber-100 px-1 text-amber-950">
            {BLANK}
          </mark>,
          p,
        ],
  );
}

export function ContractBody({
  body,
  highlightBlanks = false,
  signatures,
  className,
}: {
  body: string;
  highlightBlanks?: boolean;
  /** מה מוצג במקום [[signatures]] (בתצוגה מקדימה / בעמוד החתימה) */
  signatures?: ReactNode;
  className?: string;
}) {
  return (
    <article
      dir="rtl"
      lang="he"
      className={cn("flex flex-col gap-2 text-[15px] leading-7 text-foreground", className)}
      data-testid="contract-body"
    >
      {contractBlocks(body).map((b, i) => {
        switch (b.kind) {
          case "title":
            return (
              <h2 key={i} className="text-center text-xl font-bold leading-snug">
                {b.text}
              </h2>
            );
          case "subtitle":
            return (
              <p key={i} className="text-center text-sm text-muted-foreground">
                {b.text}
              </p>
            );
          case "heading":
            return (
              <h3 key={i} className="mt-3 text-base font-bold">
                {b.text}
              </h3>
            );
          case "strong":
            return (
              <p key={i} className="font-semibold">
                {withBlanks(b.text, highlightBlanks)}
              </p>
            );
          case "item":
            return (
              <p
                key={i}
                className="relative ps-4 before:absolute before:start-0 before:content-['•']"
              >
                {withBlanks(b.text, highlightBlanks)}
              </p>
            );
          case "box":
            return (
              <p key={i} className="rounded-md border bg-muted/50 p-3 text-sm">
                {withBlanks(b.text, highlightBlanks)}
              </p>
            );
          case "signatures":
            return (
              <div key={i} className="mt-4">
                {signatures ?? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      חתימת המשכיר (צד א')
                    </p>
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      חתימת השוכר / המזמין (צד ב')
                    </p>
                  </div>
                )}
              </div>
            );
          default:
            return <p key={i}>{withBlanks(b.text, highlightBlanks)}</p>;
        }
      })}
    </article>
  );
}
