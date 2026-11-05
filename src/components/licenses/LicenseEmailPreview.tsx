import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * המייל בדיוק כפי שייבנה בשליחה (אותה פונקציה), בתוך iframe ב-sandbox — בלי סקריפטים ובלי
 * גישה לדף. מעבר בין רוחב מחשב לרוחב נייד (375px) כדי לראות את שתי התצוגות.
 */
export function LicenseEmailPreview({ html, subject }: { html: string; subject: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">כך המייל ייראה אצל הלקוח</p>
          <p className="truncate text-xs text-muted-foreground">נושא: {subject}</p>
        </div>
        <div
          role="group"
          aria-label="רוחב התצוגה"
          className="inline-flex rounded-lg border border-border p-0.5"
        >
          <Button
            type="button"
            size="sm"
            variant={device === "desktop" ? "secondary" : "ghost"}
            aria-pressed={device === "desktop"}
            className="h-8 gap-1.5"
            onClick={() => setDevice("desktop")}
          >
            <Monitor className="size-4" aria-hidden /> מחשב
          </Button>
          <Button
            type="button"
            size="sm"
            variant={device === "mobile" ? "secondary" : "ghost"}
            aria-pressed={device === "mobile"}
            className="h-8 gap-1.5"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone className="size-4" aria-hidden /> נייד
          </Button>
        </div>
      </div>
      <div className="flex justify-center rounded-xl border border-border bg-muted/40 p-2 sm:p-3">
        <iframe
          title="תצוגה מקדימה של מייל הרישיון"
          srcDoc={html}
          sandbox=""
          data-device={device}
          className={cn(
            "h-[520px] rounded-lg border border-border bg-white shadow-sm transition-[width] duration-200 sm:h-[600px]",
            device === "desktop" ? "w-full" : "w-[375px] max-w-full",
          )}
        />
      </div>
    </div>
  );
}
