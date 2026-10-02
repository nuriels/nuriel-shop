import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const COLOR_SUGGESTIONS = ["1.5 ליטר", "פחית 330 מ\"ל", "בקבוק זכוכית", "ללא סוכר", "אריזת מארז"] as const;

/** ניהול וריאציות מוצר (נפחים/טעמים/אריזות) – בחירת כמה תגיות והוספת תגית חופשית */
export function ColorsInput({
  value,
  onChange,
  id = "product-colors",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (color: string) => {
    const clean = color.trim().slice(0, 30);
    if (clean === "" || value.includes(clean) || value.length >= 12) return;
    onChange([...value, clean]);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>וריאציות (נפח / טעם / אריזה)</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((color) => (
            <Badge key={color} variant="secondary" className="gap-1 py-1 pr-2 text-sm">
              {color}
              <button
                type="button"
                aria-label={`הסרת ${color}`}
                className="rounded-full p-0.5 hover:bg-background"
                onClick={() => onChange(value.filter((c) => c !== color))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={30}
          placeholder="הוספת וריאציה (לדוגמה: 1.5 ליטר)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
              setDraft("");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            add(draft);
            setDraft("");
          }}
        >
          <Plus className="size-4" />
          הוסף
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {COLOR_SUGGESTIONS.filter((color) => !value.includes(color)).map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => add(color)}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            + {color}
          </button>
        ))}
      </div>
    </div>
  );
}

/** תגיות צבעים לתצוגה בגריד ובקיוסק */
export function ColorTags({ colors }: { colors: string[] | null | undefined }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {colors.map((color) => (
        <span
          key={color}
          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
        >
          {color}
        </span>
      ))}
    </div>
  );
}
