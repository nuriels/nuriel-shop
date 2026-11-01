// עריכה ישירה מהתצוגה המקדימה (D2): בעורך האתר, טקסט של מקטע ניתן לעריכה במקום — לוחצים,
// כותבים, ויוצאים (Enter / לחיצה בחוץ; Esc מבטל). השינוי נשלח לעורך (postMessage, אותו מקור),
// שם הוא עובר את אותה בדיקה (normalizeDesign) ונשמר בטיוטה כמו כל שינוי. באתר עצמו — טקסט רגיל.
// טקסט ריק = חזרה לברירת המחדל (מנתוני העסק).
import { useRef, type ReactNode } from "react";
import { INLINE_FIELD_LABELS, PREVIEW_EDIT_MESSAGE, type InlineField } from "../design/preview";
import { useSite } from "../lib/site-context";

export function Editable({
  section,
  field,
  value,
  multiline = false,
}: {
  /** מזהה המקטע (בלי — לא ניתן לעריכה, למשל מחוץ לעמוד הבית) */
  section: string | undefined;
  field: InlineField;
  value: string;
  multiline?: boolean;
}): ReactNode {
  const { preview } = useSite();
  if (!preview || !section) return value;
  // key — טקסט חדש מהעורך מחליף את האלמנט (בלי להתנגש בעריכה של הדפדפן בתוכו)
  return (
    <InlineText key={value} section={section} field={field} value={value} multiline={multiline} />
  );
}

function InlineText({
  section,
  field,
  value,
  multiline,
}: {
  section: string;
  field: InlineField;
  value: string;
  multiline: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = multiline ? el.innerText : (el.textContent ?? "");
    const next = raw
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (next === value.trim()) return;
    window.parent.postMessage(
      { type: PREVIEW_EDIT_MESSAGE, section, field, value: next },
      window.location.origin,
    );
  };
  return (
    <span
      ref={ref}
      data-inline-edit=""
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label={`עריכה: ${INLINE_FIELD_LABELS[field]}`}
      title="לחצו כדי לערוך"
      tabIndex={0}
      spellCheck
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        } else if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="cursor-text rounded-sm outline-current/40 outline-offset-4 hover:outline-1 hover:outline-dashed focus:outline-2 focus:outline-solid"
      style={multiline ? { whiteSpace: "pre-line", display: "inline-block" } : undefined}
    >
      {value}
    </span>
  );
}
