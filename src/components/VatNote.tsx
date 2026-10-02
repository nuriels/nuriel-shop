import { useSiteSettings } from "@/hooks/useSiteSettings";
import { cn } from "@/lib/utils";

/** האם מחירי הקטלוג בחנות הזו הם לפני מע"מ (הגדרות החנות → "מע״מ ותצוגת מחירים") */
function usePricesExcludeVat(): boolean {
  const { settings } = useSiteSettings();
  return settings !== null && !settings.prices_include_vat;
}

/**
 * "+ מע״מ" קטן ליד מחיר — רק בחנות שמחירי הקטלוג שלה לפני מע"מ. בחנות
 * שהמחירים כוללים מע"מ לא מוצג כלום (המחיר הוא הסופי).
 */
export function VatNote({ className }: { className?: string }) {
  if (!usePricesExcludeVat()) return null;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-xs",
        className,
      )}
    >
      + מע״מ
    </span>
  );
}
