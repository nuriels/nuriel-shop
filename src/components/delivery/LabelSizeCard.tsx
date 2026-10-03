import { useEffect, useState } from "react";
import { FileDown, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LABEL_SIZE_LIMITS, labelSizeProblem } from "@/lib/site";
import {
  SAMPLE_LABEL,
  downloadBlob,
  normalizeLabelSize,
  renderLabelCanvas,
  renderLabelsPdf,
} from "@/lib/shipping-label";
import { cn } from "@/lib/utils";

/** מידות נפוצות של מדבקות למדפסות תרמיות */
const PRESETS: { width: number; height: number; label: string }[] = [
  { width: 70, height: 50, label: "70×50" },
  { width: 100, height: 150, label: "100×150 (4×6)" },
  { width: 100, height: 100, label: "100×100" },
  { width: 58, height: 40, label: "58×40" },
];

/**
 * הגדרות מדבקת משלוח: רוחב וגובה במ"מ (ברירת מחדל 70×50), עם תצוגה מקדימה
 * חיה — אותו ציור שיודפס — והורדת מדבקת בדיקה להדפסה במדפסת (Zebra וכדומה).
 */
export function LabelSizeCard({
  width,
  height,
  storeName,
  storePhone,
  onChange,
}: {
  width: number;
  height: number;
  storeName: string;
  storePhone: string;
  onChange: (next: { label_width_mm: number; label_height_mm: number }) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const problem = labelSizeProblem(width, height);
  const sample = {
    ...SAMPLE_LABEL,
    storeName: storeName.trim() || SAMPLE_LABEL.storeName,
    storePhone: storePhone.trim() || SAMPLE_LABEL.storePhone,
  };

  // התצוגה המקדימה מצוירת מחדש (בהשהיה קצרה) בכל שינוי מידה
  useEffect(() => {
    if (problem) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderLabelCanvas(sample, { width, height }, 8)
        .then((canvas) => {
          if (!cancelled) setPreview(canvas.toDataURL("image/png"));
        })
        .catch(() => !cancelled && setPreview(null));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sample נגזר מ-storeName/storePhone
  }, [width, height, problem, storeName, storePhone]);

  const testPrint = async () => {
    setTesting(true);
    try {
      const size = normalizeLabelSize({ width, height });
      const blob = await renderLabelsPdf([sample], size);
      downloadBlob(blob, `label-test-${size.width}x${size.height}.pdf`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפקת מדבקת הבדיקה נכשלה");
    } finally {
      setTesting(false);
    }
  };

  // התצוגה: עד 260px רוחב / 300px גובה, ביחס המדויק של המדבקה
  const scale = Math.min(260 / width, 300 / height);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="size-4" aria-hidden="true" />
          מדבקות משלוח
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-80">
            <div className="space-y-2">
              <Label htmlFor="s-label-width">רוחב (מ"מ)</Label>
              <Input
                id="s-label-width"
                type="number"
                min={LABEL_SIZE_LIMITS.width.min}
                max={LABEL_SIZE_LIMITS.width.max}
                step="1"
                dir="ltr"
                className="numeric"
                value={Number.isFinite(width) ? width : ""}
                onChange={(e) =>
                  onChange({ label_width_mm: Number(e.target.value), label_height_mm: height })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-label-height">גובה (מ"מ)</Label>
              <Input
                id="s-label-height"
                type="number"
                min={LABEL_SIZE_LIMITS.height.min}
                max={LABEL_SIZE_LIMITS.height.max}
                step="1"
                dir="ltr"
                className="numeric"
                value={Number.isFinite(height) ? height : ""}
                onChange={(e) =>
                  onChange({ label_width_mm: width, label_height_mm: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const active = preset.width === width && preset.height === height;
              return (
                <button
                  key={preset.label}
                  type="button"
                  // מידות "רוחב×גובה" — LTR, אחרת בעברית זה מתהפך ל-50×70
                  dir="ltr"
                  onClick={() =>
                    onChange({ label_width_mm: preset.width, label_height_mm: preset.height })
                  }
                  className={cn(
                    "numeric rounded-full border px-3 py-1 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}
          <p className="text-xs leading-5 text-muted-foreground">
            בניהול ההזמנות בוחרים הזמנות ולוחצים "מדבקות משלוח (PDF)" — עמוד אחד לכל מדבקה בגודל
            המדויק שהוגדר כאן. הפריסה (שם, כתובת, טלפון, מספר הזמנה וברקוד) מותאמת אוטומטית לגודל.
            בהדפסה: גודל נייר = גודל המדבקה, "גודל בפועל" (100%) בלי התאמה לעמוד.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing || problem !== null}
            onClick={() => void testPrint()}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            מדבקת בדיקה (PDF)
          </Button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-muted-foreground">תצוגה מקדימה</span>
          <div
            className="flex items-center justify-center overflow-hidden rounded-md bg-white shadow-soft ring-1 ring-border"
            style={{
              width: problem ? 180 : Math.round(width * scale),
              height: problem ? 120 : Math.round(height * scale),
            }}
          >
            {preview && !problem ? (
              <img
                src={preview}
                alt={`תצוגה מקדימה של מדבקה ${width}×${height} מ"מ`}
                className="size-full"
              />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          <span dir="ltr" className="numeric text-xs text-muted-foreground">
            {width} × {height} mm
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
