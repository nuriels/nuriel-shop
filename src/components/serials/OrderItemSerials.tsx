import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Hash, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { SerialSmartInput } from "@/components/serials/SerialSmartInput";
import { assignSerial, loadItemSerials, unassignSerial } from "@/lib/serials-data";
import {
  formatWarrantyDate,
  missingSerials,
  SERIALS_CHANGED,
  splitSerials,
  type AssignedSerial,
} from "@/lib/serials";
import { cn } from "@/lib/utils";

const LEFT_STATUSES = new Set(["awaiting_courier", "shipped", "delivered"]);

/**
 * חלק 35: המספרים הסידוריים של שורה בהזמנה (ניהול / ליקוט / משלוחים).
 *  • "1 מתוך 2" — כמה יחידות כבר קיבלו מספר; אי אפשר לסמן "נשלחה" /
 *    "נמסרה" לפני שכל היחידות קיבלו (נאכף במסד).
 *  • קלט חכם: סריקה (Enter) או בחירה מרשימת היחידות הפנויות → השיוך ננעל
 *    להזמנה והיחידה עוברת ל"נמכר".
 *  • הסרה (נסרק בטעות): לפני שההזמנה יצאה — מי שמלקט; אחרי — רק מנהל.
 */
export function OrderItemSerials({
  item,
  orderStatus,
  canEdit,
  isManager = false,
  onChanged,
  compact = false,
}: {
  item: {
    id: string;
    product_id: string;
    product_name: string | null;
    quantity: number;
    serial_number?: string | null;
    serial_required?: boolean | null;
    warranty_until?: string | null;
  };
  orderStatus: string;
  /** הרשאת ליקוט (מחסנאי / מנהל / בעלים) */
  canEdit: boolean;
  /** בעלים / מנהל — מותר להסיר גם אחרי שההזמנה יצאה */
  isManager?: boolean;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [assigned, setAssigned] = useState<AssignedSerial[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [serialText, setSerialText] = useState(item.serial_number ?? null);
  const [warranty, setWarranty] = useState(item.warranty_until ?? null);

  useEffect(() => {
    setSerialText(item.serial_number ?? null);
    setWarranty(item.warranty_until ?? null);
  }, [item.serial_number, item.warranty_until]);

  const serials = assigned ? assigned.map((s) => s.serial_number) : splitSerials(serialText);
  const missing = missingSerials({
    quantity: item.quantity,
    serial_number: serials.join(", "),
    serial_required: item.serial_required ?? false,
  });
  const cancelled = orderStatus === "cancelled";
  const left = LEFT_STATUSES.has(orderStatus);
  const canRemove = canEdit && !cancelled && (!left || isManager);

  const reload = useCallback(async () => {
    try {
      const rows = await loadItemSerials(item.id);
      setAssigned(rows);
      setSerialText(rows.map((row) => row.serial_number).join(", ") || null);
      setWarranty(
        rows.reduce<string | null>((max, row) => {
          if (!row.warranty_until) return max;
          return !max || row.warranty_until > max ? row.warranty_until : max;
        }, null),
      );
    } catch {
      setAssigned(null);
    }
  }, [item.id]);

  // עם הרשאה — המזהים של המספרים (להסרה)
  useEffect(() => {
    if (canEdit && splitSerials(item.serial_number).length > 0) void reload();
  }, [canEdit, item.serial_number, reload]);

  if (!item.serial_required && serials.length === 0) return null;

  const pick = async (serial: string) => {
    const result = await assignSerial(item.id, serial);
    toast.success(
      `${result.serial_number} שויך ל"${item.product_name ?? "מוצר"}" (${result.assigned} מתוך ${result.required})`,
    );
    await reload();
    window.dispatchEvent(new Event(SERIALS_CHANGED));
    onChanged?.();
  };

  const remove = async (serial: AssignedSerial) => {
    setRemoving(serial.id);
    try {
      await unassignSerial(item.id, serial.id);
      toast.success(`${serial.serial_number} הוסר מההזמנה וחזר למלאי`);
      await reload();
      window.dispatchEvent(new Event(SERIALS_CHANGED));
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההסרה נכשלה");
    } finally {
      setRemoving(null);
    }
  };

  const complete = item.serial_required ? missing === 0 : true;
  const warrantyText = formatWarrantyDate(warranty);

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border px-2.5 py-2",
        complete
          ? "border-green-600/25 bg-green-50/60 dark:bg-green-950/20"
          : "border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20",
        compact && "py-1.5",
      )}
      data-testid="order-item-serials"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold",
            complete ? "text-green-800 dark:text-green-300" : "text-amber-900 dark:text-amber-200",
          )}
          data-testid="serial-progress"
        >
          {complete ? (
            <BadgeCheck className="size-3.5" aria-hidden="true" />
          ) : (
            <Hash className="size-3.5" aria-hidden="true" />
          )}
          מספר סידורי: {serials.length} מתוך {item.quantity}
        </span>
        {!complete && !cancelled && (
          <span className="text-amber-900/80 dark:text-amber-200/80">
            חובה לפני "נשלחה" / "נמסרה"
          </span>
        )}
        {warrantyText && <span className="text-muted-foreground">· אחריות עד {warrantyText}</span>}
      </div>

      {serials.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="מספרים סידוריים ששויכו">
          {(assigned ?? serials.map((serial) => ({ id: serial, serial_number: serial }))).map(
            (serial) => (
              <li
                key={serial.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs"
                dir="ltr"
                data-testid="serial-chip"
              >
                {serial.serial_number}
                {canRemove && assigned && (
                  <button
                    type="button"
                    onClick={() => void remove(serial as AssignedSerial)}
                    disabled={removing !== null}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`הסרת ${serial.serial_number} מההזמנה`}
                    data-testid="serial-chip-remove"
                  >
                    {removing === serial.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <X className="size-3" />
                    )}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canEdit && !cancelled && missing > 0 && (
        <SerialSmartInput
          productId={item.product_id}
          onPick={pick}
          exclude={serials}
          placeholder={`סרקו מספר סידורי (${serials.length + 1} מתוך ${item.quantity})`}
        />
      )}
    </div>
  );
}
