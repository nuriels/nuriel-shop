// NURIEL AI SEO ENGINE — the store admin's "SEO וגוגל" tab: the platform SEO center (technical check, keyword
// ideas, Search Console, settings) with the store's own proposals list.
import { SeoCenter } from "@/platform/seo/ui/SeoCenter";
import { StoreSeoProposals } from "./StoreSeoProposals";

export function StoreSeoTab() {
  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">SEO וגוגל</h1>
        <p className="text-sm text-muted-foreground">
          איך החנות נראית בגוגל, מה כדאי לשפר, ונתונים אמיתיים מ-Google — בלי הבטחות לדירוג ובלי
          קיצורי דרך.
        </p>
      </header>
      <SeoCenter variant="store" proposals={<StoreSeoProposals />} />
    </div>
  );
}
