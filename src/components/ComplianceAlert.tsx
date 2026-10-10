import { FileText, Info, ShieldAlert, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { complianceGaps } from "@/lib/legal-content";
import { cn } from "@/lib/utils";

/**
 * חלק 37 / 37ב: התראה בלוח הבקרה לבעל החנות.
 *  • חובה (אדום) — חסר אימייל או טלפון: התקנון מפנה אליהם, ובלעדיהם הוא לא
 *    תקף ולא עומד בדרישות חברות הסליקה.
 *  • מומלץ (כתום) — פרטי העסק האחרים (ח.פ./ע.מ, כתובת, שם) ומקומות להשלמה.
 * נעלמת לבד כשהכל מולא.
 */
export function ComplianceAlert({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const { settings } = useSiteSettings();
  const { contact, recommended } = complianceGaps(settings);
  if (contact.length === 0 && recommended.length === 0) return null;
  const required = contact.length > 0;
  const Icon = required ? ShieldAlert : Info;
  return (
    <div
      role={required ? "alert" : "status"}
      data-testid="compliance-alert"
      data-level={required ? "required" : "recommended"}
      className={cn(
        "flex flex-col gap-3 rounded-xl border-2 p-4 shadow-sm sm:flex-row sm:items-start",
        required
          ? "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-50"
          : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50",
      )}
    >
      <Icon
        className={cn(
          "size-7 shrink-0",
          required ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold leading-6">
          {required
            ? "עליך להשלים את פרטי העסק (אימייל וטלפון) כדי שהתקנון המשפטי שלך יהיה תקף וכדי לעמוד בדרישות חברות הסליקה."
            : "מומלץ להשלים את פרטי העסק — הם מופיעים בתקנון ובאתר, ומייחסים את החנות ואת המכירות לעסק שלך."}
        </p>
        <p className="text-sm leading-6 opacity-90">
          {required && (
            <>
              חסר: <span className="font-semibold">{contact.join(" ו")}</span>.{" "}
            </>
          )}
          {recommended.length > 0 && (
            <>
              {required ? "מומלץ גם: " : "חסר: "}
              <span className="font-semibold">{recommended.join(" · ")}</span>.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onOpenTab("site")}>
            <Store className="size-4" aria-hidden="true" />
            השלמת פרטי העסק
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent"
            onClick={() => onOpenTab("legal")}
          >
            <FileText className="size-4" aria-hidden="true" />
            תקנון ומדיניות פרטיות
          </Button>
        </div>
      </div>
    </div>
  );
}
