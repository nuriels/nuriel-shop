import { Link } from "@tanstack/react-router";
import { PackageX, Phone } from "lucide-react";
import { categoryHref } from "@/components/CrawlableLink";
import { useSiteSettings } from "@/hooks/useSiteSettings";

/**
 * מוצר שאזל מהמלאי — העמוד נשאר (גוגל: עמוד של מוצר שאזל נשאר באוויר, מסומן OutOfStock בנתונים
 * המובנים), אבל לא מבוי סתום: מה אפשר לעשות עכשיו — חלופות שיש במלאי (הרשימה למטה, כשיש), כל
 * המוצרים בקטגוריה, ולשאול את החנות מתי יחזור. רק קישורים אמיתיים (<a href>) ופרטי קשר שהחנות
 * כבר מפרסמת בתחתית האתר — בלי הבטחה למועד חזרה ובלי טופס חדש.
 */
export function OutOfStockHelp({
  category,
  hasAlternatives,
}: {
  category: string;
  /** יש רשימת חלופות במלאי מתחת (#related-title) */
  hasAlternatives: boolean;
}) {
  const { settings } = useSiteSettings();
  const phone = settings?.support_phone?.trim() || settings?.business_phone?.trim() || "";
  const tel = phone.replace(/[^\d+]/g, "");
  return (
    <section
      aria-labelledby="out-of-stock-title"
      data-testid="out-of-stock-help"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <h2
        id="out-of-stock-title"
        className="flex items-center gap-2 font-display text-lg font-bold text-foreground"
      >
        <PackageX className="size-5 text-muted-foreground" aria-hidden="true" />
        המוצר הזה אזל מהמלאי כרגע
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
        {hasAlternatives && (
          <li>
            <a
              href="#related-title"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              מוצרים דומים שיש במלאי
            </a>
          </li>
        )}
        {category && (
          <li>
            <a
              href={categoryHref(category)}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              כל המוצרים בקטגוריה {category}
            </a>
          </li>
        )}
        <li>
          <Link
            to="/contact"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            לשאול מתי המוצר יחזור למלאי
          </Link>
        </li>
        {tel && (
          <li className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="size-4" aria-hidden="true" />
            <a
              href={`tel:${tel}`}
              dir="ltr"
              className="font-semibold text-foreground hover:underline"
            >
              {phone}
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}
