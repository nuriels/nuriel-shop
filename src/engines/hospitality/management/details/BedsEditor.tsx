// מיטות לפי חדר (Stage 2d): שורות של "באיזה חדר" (לא חובה), סוג המיטה וכמה. סדר בחצים,
// הסרה, הוספה; "ישנים עד N", ואזהרה (לא חסימה) כשמקומות השינה פחות מהאורחים המרבי.
import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button, Input, Label, cn } from "@/platform/ui";
import { BED_TYPES, type BedType } from "../../types/catalog";
import { MAX_BED_ROWS, sleepsIn } from "../../validation/details";
import { bedRows, moveItem, type BedFormRow } from "../catalog/model";
import { BED_TYPE_LABELS, ROOM_SUGGESTIONS } from "./labels";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function BedsEditor(props: {
  rows: BedFormRow[];
  onChange: (rows: BedFormRow[]) => void;
  capacity: number | null;
  error?: string | undefined;
}) {
  const base = useId();
  const listId = `${base}-rooms`;
  const set = (i: number, patch: Partial<BedFormRow>) =>
    props.onChange(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = props.rows.every((r) => /^\d+$/.test(r.quantity.trim()));
  const sleeps = valid ? sleepsIn(bedRows(props.rows)) : null;
  const short =
    sleeps !== null && props.capacity !== null && props.rows.length > 0 && sleeps < props.capacity;
  const cribs = props.rows.some((r) => r.bed_type === "crib");

  return (
    <fieldset className="flex flex-col gap-3" data-testid="beds-editor">
      <legend className="mb-1 text-sm font-medium">מיטות</legend>
      <datalist id={listId}>
        {ROOM_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {props.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          עוד לא הוגדרו מיטות. מוסיפים שורה לכל סוג מיטה — ואפשר לציין באיזה חדר.
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {props.rows.map((row, i) => {
          const n = i + 1;
          const id = `${base}-${i}`;
          return (
            <li
              key={id}
              data-bed-row={n}
              className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end"
            >
              <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <Label htmlFor={`${id}-room`}>חדר (לא חובה)</Label>
                <Input
                  id={`${id}-room`}
                  list={listId}
                  value={row.room_label}
                  maxLength={60}
                  placeholder="למשל חדר הורים"
                  onChange={(e) => set(i, { room_label: e.target.value })}
                  className="min-h-11"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-type`}>סוג המיטה</Label>
                <select
                  id={`${id}-type`}
                  value={row.bed_type}
                  onChange={(e) => set(i, { bed_type: e.target.value as BedType })}
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {BED_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BED_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${id}-qty`}>כמה</Label>
                <Input
                  id={`${id}-qty`}
                  inputMode="numeric"
                  dir="ltr"
                  value={row.quantity}
                  onChange={(e) =>
                    set(i, { quantity: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })
                  }
                  className="min-h-11 text-center"
                />
              </div>
              <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={`הזזת שורת מיטות ${n} למעלה`}
                  disabled={i === 0}
                  onClick={() => props.onChange(moveItem(props.rows, i, i - 1))}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={`הזזת שורת מיטות ${n} למטה`}
                  disabled={i === props.rows.length - 1}
                  onClick={() => props.onChange(moveItem(props.rows, i, i + 1))}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={`הסרת שורת מיטות ${n}`}
                  onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {props.rows.length < MAX_BED_ROWS && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit gap-2"
          onClick={() =>
            props.onChange([...props.rows, { bed_type: "double", quantity: "1", room_label: "" }])
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת מיטה
        </Button>
      )}
      {sleeps !== null && props.rows.length > 0 && (
        <p className="text-sm" data-testid="beds-sleeps">
          ישנים עד {plural(sleeps, "אדם אחד", "אנשים")}
          {cribs ? " (ועריסה לתינוק)" : ""}.
        </p>
      )}
      {short && (
        <p role="note" className={cn("rounded-md bg-amber-50 p-2 text-sm text-amber-900")}>
          שימו לב: מקומות השינה ({sleeps}) פחות ממספר האורחים המרבי ({props.capacity}). אפשר לשמור
          כך — רק לוודא שזה נכון.
        </p>
      )}
      {props.error && <p className="text-sm text-destructive">{props.error}</p>}
    </fieldset>
  );
}
