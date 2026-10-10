import { FileText, ShieldAlert, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { complianceGaps } from "@/lib/legal-content";

/**
 * חלק 37: התראת חובה בלוח הבקרה — כל עוד חסרים פרטי העסק (ח.פ./ע.מ, כתובת,
 * טלפון, דוא"ל) או התקנון / מדיניות הפרטיות, החנות לא עומדת בדרישות חברות
 * הסליקה. נעלמת לבד כשהכל מולא.
 */
export function ComplianceAlert({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const { settings } = useSiteSettings();
  const gaps = complianceGaps(settings);
  if (gaps.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="compliance-alert"
      className="flex flex-col gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-950 shadow-sm sm:flex-row sm:items-start dark:border-red-800 dark:bg-red-950/40 dark:text-red-50"
    >
      <ShieldAlert className="size-7 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold leading-6">
          עליך להשלים את פרטי העסק והתקנון כדי לעמוד בדרישות חברות הסליקה ולהתחיל למכור.
        </p>
        <p className="text-sm leading-6 opacity-90">
          חסר: <span className="font-semibold">{gaps.join(" · ")}</span>. הפרטים מופיעים באתר
          ובתקנון, ומייחסים את החנות ואת המכירות לעסק שלך.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onOpenTab("site")}>
            <Store className="size-4" aria-hidden="true" />
            השלמת פרטי העסק
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 bg-transparent dark:border-red-800"
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
