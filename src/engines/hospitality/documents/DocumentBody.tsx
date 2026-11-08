// הטקסט של מסמך כרכיבים: כותרות (h2), פסקאות ורשימות — טקסט בלבד, בלי HTML מהמסמך.
// בתצוגה המקדימה בניהול: משתנה שלא מולא ({{…}}) ופרט להשלמה ([[…]]) מסומנים בצהוב.
import type { ReactNode } from "react";
import { toBlocks } from "./render";

const MARK = /(\{\{[^}]*\}\}|\[\[[^\]]*\]\])/g;

function Line({ text, markMissing }: { text: string; markMissing: boolean }): ReactNode {
  if (!markMissing) return text;
  return text.split(MARK).map((part, i) =>
    MARK.test(part) ? (
      <mark key={i} className="rounded bg-amber-200 px-1 text-amber-950">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function DocumentBody({
  text,
  markMissing = false,
  headingClassName = "mb-2 mt-6 text-lg font-semibold first:mt-0",
}: {
  text: string;
  markMissing?: boolean;
  headingClassName?: string;
}) {
  return (
    <div className="space-y-3 leading-relaxed" data-document-body="">
      {toBlocks(text).map((b, i) =>
        b.kind === "h" ? (
          <h2 key={i} className={headingClassName}>
            <Line text={b.text} markMissing={markMissing} />
          </h2>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 ps-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <Line text={it} markMissing={markMissing} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Line text={b.text} markMissing={markMissing} />
          </p>
        ),
      )}
    </div>
  );
}
