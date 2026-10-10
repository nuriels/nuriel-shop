import { Braces, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  LEGAL_VARIABLES,
  legalVariablesIn,
  type LegalVariableKey,
  type LegalVariables,
} from "@/lib/legal-content";
import { cn } from "@/lib/utils";

/**
 * חלק 37: המשתנים של העמודים המשפטיים ({{store_name}} וכו') — לחיצה מוסיפה
 * משתנה במקום הסמן בעורך; לצד כל משתנה מוצג הערך שיופיע באתר (מפרטי העסק
 * בהגדרות). משתנה שבשימוש בנוסח ואין לו ערך — מסומן באדום.
 */
export function LegalVariablesBox({
  editorId,
  html,
  values,
}: {
  /** ה-id של העורך (RichTextEditor) שאליו מוסיפים */
  editorId: string;
  /** הנוסח הנוכחי — כדי לדעת אילו משתנים בשימוש */
  html: string;
  values: LegalVariables;
}) {
  const used = new Set<LegalVariableKey>(legalVariablesIn(html));
  const missing = LEGAL_VARIABLES.filter(
    (variable) => used.has(variable.key) && values[variable.key] === "",
  );

  const insert = (key: LegalVariableKey) => {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      // הסמן לא בעורך — מוסיפים בסוף הנוסח
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      toast.message("המשתנה נוסף בסוף הנוסח — אפשר להזיז אותו לכל מקום");
    }
    document.execCommand("insertText", false, `{{${key}}}`);
  };

  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"
      data-testid="legal-variables"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Braces className="size-3.5 text-primary" aria-hidden="true" />
        משתנים — מוחלפים באתר בפרטי העסק שלכם (לחיצה מוסיפה במקום הסמן)
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {LEGAL_VARIABLES.map((variable) => {
          const value = values[variable.key];
          return (
            <li key={variable.key}>
              <button
                type="button"
                // שומר את מקום הסמן בעורך
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(variable.key)}
                title={`${variable.label}: ${value || "לא הוגדר"}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  used.has(variable.key) && value === ""
                    ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
                    : "border-border",
                )}
              >
                <code dir="ltr" className="font-mono text-[11px]">{`{{${variable.key}}}`}</code>
                <span className="text-muted-foreground">→</span>
                <span className="max-w-40 truncate font-medium">{value || "לא הוגדר"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-red-700 dark:text-red-300"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          חסרים בפרטי העסק: {missing.map((variable) => variable.label).join(", ")} — באתר יוצג
          במקומם סימון להשלמה. משלימים ב"הגדרות אתר" ← פרטי העסק.
        </p>
      )}
    </div>
  );
}
