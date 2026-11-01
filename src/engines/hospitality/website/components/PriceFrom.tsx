// "החל מ- ₪750 ללילה" — או "המחיר לפי התאריכים" כשליחידה אין מחיר בסיס (המחיר מכללי המחיר).
// המחיר הסופי — רק מהצעת המחיר בשרת.
import { useCopy } from "../copy";
import { money } from "../lib/format";

export function PriceFrom({
  price,
  currency,
  size = "md",
}: {
  price: number;
  currency: string;
  size?: "md" | "lg";
}) {
  const t = useCopy();
  if (!(price > 0))
    return <span className="text-sm text-muted-foreground">{t.facts.priceOnDates}</span>;
  const small = size === "lg" ? "text-sm" : "text-xs";
  return (
    <>
      <span className={`${small} text-muted-foreground`}>{t.facts.from}</span>
      <span className={`font-display ms-1 ${size === "lg" ? "text-3xl" : "text-2xl"}`}>
        {money(price, currency)}
      </span>
      <span className={`ms-1 ${small} text-muted-foreground`}>{t.facts.perNight}</span>
    </>
  );
}
