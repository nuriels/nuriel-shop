import { useSiteSettings } from "@/hooks/useSiteSettings";
import { cn } from "@/lib/utils";

/**
 * האם להוסיף "+ מע״מ" ליד מחירי הקטלוג: רק בחנות שהמחירים שלה לפני מע"מ, וגובה
 * מע"מ בכלל — עוסק פטור (חלק 23, מע"מ 0%) מציג את המחיר כמו שהוא
 */
function usePricesExcludeVat(): boolean {
  const { settings } = useSiteSettings();
  return (
    settings !== null &&
    !settings.prices_include_vat &&
    settings.business_type !== "exempt" &&
    Number(settings.vat_rate) > 0
  );
}

/**
 * "+ מע״מ" קטן ליד מחיר — רק בחנות שמחירי הקטלוג שלה לפני מע"מ. בחנות
 * שהמחירים כוללים מע"מ (או עוסק פטור) לא מוצג כלום (המחיר הוא הסופי).
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
