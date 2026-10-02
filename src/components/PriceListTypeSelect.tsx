import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRICE_LIST_TYPE_LABEL, toPriceListType, type PriceListType } from "@/lib/price-list";

/**
 * בחירת "סוג מחירון" ללקוח — מופיעה בהקמת לקוח, באישור לקוח ממתין ובעריכת
 * משתמש. מחירון אישי: המחירים נקבעים בלשונית "ניהול מחירי לקוחות מיוחדים",
 * ומוצר בלי מחיר אישי נשאר במחיר הרגיל.
 */
export function PriceListTypeSelect({
  value,
  onChange,
  disabled = false,
  showLabel = true,
  compact = false,
}: {
  value: PriceListType;
  onChange: (value: PriceListType) => void;
  disabled?: boolean;
  showLabel?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "space-y-2"}>
      {showLabel && <Label>סוג מחירון</Label>}
      <Select value={value} onValueChange={(v) => onChange(toPriceListType(v))} disabled={disabled}>
        <SelectTrigger dir="rtl" className={compact ? "h-9 w-44" : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value="regular">{PRICE_LIST_TYPE_LABEL.regular}</SelectItem>
          <SelectItem value="custom">{PRICE_LIST_TYPE_LABEL.custom}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
