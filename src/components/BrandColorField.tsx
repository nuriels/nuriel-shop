import { useEffect, useState } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BRAND_PRESETS,
  isTooLightForText,
  normalizeBrandColor,
  textColorOn,
} from "@/lib/brand-theme";
import { cn } from "@/lib/utils";

/**
 * בחירת צבע המותג של החנות: צבעים מוכנים, בוחר צבע חופשי וקוד HEX, ותצוגה
 * מקדימה של הכותרת והכפתור. null = עיצוב ברירת המחדל של האתר.
 */
export function BrandColorField({
  value,
  onChange,
  storeName,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  storeName: string;
}) {
  const color = normalizeBrandColor(value);
  // שדה הטקסט מתעדכן חופשי בזמן ההקלדה, והצבע נקבע רק כשהקוד שלם ותקין
  const [hex, setHex] = useState(color ?? "");
  useEffect(() => setHex(color ?? ""), [color]);

  const fg = color ? textColorOn(color) : undefined;

  return (
    <div className="space-y-3">
      <Label htmlFor="s-brand-hex">צבע המותג</Label>
      <p className="text-xs text-muted-foreground">
        צובע את הכותרת העליונה, התחתונה והכפתורים הראשיים בחנות. צבע הטקסט עליהם (לבן או כהה) נבחר
        אוטומטית כך שיהיה קריא.
      </p>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="צבעים מוכנים">
        {BRAND_PRESETS.map((preset) => {
          const selected = color === preset.color;
          return (
            <button
              key={preset.color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => onChange(preset.color)}
              className={cn(
                "grid size-9 place-items-center rounded-full border border-black/10 shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:hover:scale-110",
                selected && "ring-2 ring-foreground ring-offset-2",
              )}
              style={{ backgroundColor: preset.color }}
            >
              {selected && (
                <Check className="size-4" style={{ color: textColorOn(preset.color) }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label="בחירת צבע חופשית"
          value={color ?? "#1f3b36"}
          onChange={(e) => onChange(normalizeBrandColor(e.target.value))}
          className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
        />
        <Input
          id="s-brand-hex"
          dir="ltr"
          maxLength={7}
          placeholder="#1e3a8a"
          className="w-32 font-mono"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            const next = normalizeBrandColor(e.target.value);
            if (next) onChange(next);
          }}
          onBlur={() => setHex(color ?? "")}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={color === null}
          onClick={() => onChange(null)}
        >
          <RotateCcw className="size-4" /> עיצוב ברירת המחדל
        </Button>
      </div>

      {color && isTooLightForText(color) && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          צבע בהיר מאוד: כותרות וקישורים בצבע המותג על רקע לבן עלולים להיות קשים לקריאה.
        </p>
      )}

      {/* תצוגה מקדימה */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3",
            !color && "surface-cellar",
          )}
          style={color ? { backgroundColor: color, color: fg } : undefined}
        >
          <span className="font-display truncate text-base font-bold">{storeName}</span>
          <span className="text-xs opacity-80">קטלוג · הזמנות</span>
        </div>
        <div className="flex items-center gap-3 bg-background px-4 py-3">
          <span
            className={cn(
              "inline-flex h-9 items-center rounded-md px-4 text-sm font-medium",
              !color && "bg-primary text-primary-foreground",
            )}
            style={color ? { backgroundColor: color, color: fg } : undefined}
          >
            כפתור ראשי
          </span>
          <span className="text-xs text-muted-foreground">תצוגה מקדימה</span>
        </div>
      </div>
    </div>
  );
}
