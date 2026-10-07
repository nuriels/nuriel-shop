import { Link } from "@tanstack/react-router";
import { APP_VERSION, DEFAULT_STORE_NAME } from "@/lib/branding";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useStorePages } from "@/hooks/useStorePages";

export function AppFooter() {
  const { settings } = useSiteSettings();
  const title =
    settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME;
  const year = new Date().getFullYear();
  const phone = settings?.support_phone?.trim() || settings?.business_phone?.trim() || "";
  // חלק 30: עמודי התוכן שבעל החנות פרסם
  const pages = useStorePages();

  return (
    <footer className="surface-cellar mt-10 w-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-primary-foreground/75 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-display text-base text-primary-foreground">{title}</p>
          {settings?.business_address && <p>{settings.business_address}</p>}
          {phone && (
            <p>
              שירות לקוחות:{" "}
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                dir="ltr"
                className="hover:text-accent"
              >
                {phone}
              </a>
            </p>
          )}
          {settings?.business_email && (
            <p dir="ltr">
              <a href={`mailto:${settings.business_email}`} className="hover:text-accent">
                {settings.business_email}
              </a>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
          <nav
            aria-label="קישורים בתחתית האתר"
            className="grid grid-cols-2 gap-x-8 gap-y-1.5 self-start"
          >
            <Link to="/about" className="hover:text-accent">
              אודות
            </Link>
            <Link to="/terms" className="hover:text-accent">
              תקנון האתר
            </Link>
            <Link to="/contact" className="hover:text-accent">
              צור קשר
            </Link>
            <Link to="/privacy" className="hover:text-accent">
              מדיניות פרטיות
            </Link>
            <Link to="/sitemap" className="hover:text-accent">
              מפת האתר
            </Link>
            <Link
              to="/cancellations"
              className="font-semibold text-primary-foreground hover:text-accent"
            >
              ביטול עסקה
            </Link>
          </nav>

          {pages && pages.length > 0 && (
            <nav aria-label="מידע שימושי" data-testid="footer-pages" className="space-y-2">
              <p className="font-semibold text-primary-foreground">מידע שימושי</p>
              <ul className="space-y-1.5">
                {pages.map((page) => (
                  <li key={page.id}>
                    <Link
                      to="/pages/$slug"
                      params={{ slug: page.slug }}
                      className="hover:text-accent"
                    >
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-primary-foreground/55">
          <span>
            © {year} {title}. כל הזכויות שמורות.
          </span>
          <span>
            מופעל ע״י{" "}
            <a href="https://nuriel-shop.co.il" className="hover:text-accent">
              נוריאל מחשבים
            </a>{" "}
            · <span dir="ltr">גרסה {APP_VERSION}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
