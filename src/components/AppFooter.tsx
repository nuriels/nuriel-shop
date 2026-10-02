import { Link } from "@tanstack/react-router";
import { APP_VERSION } from "@/lib/branding";
import { useSiteSettings } from "@/hooks/useSiteSettings";

export function AppFooter() {
  const { settings } = useSiteSettings();
  const title = settings?.business_name?.trim() || settings?.site_title || "סוכנות המשקאות";
  const phone = settings?.support_phone?.trim() || settings?.business_phone?.trim() || "";

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

        <nav className="flex flex-col gap-1.5">
          <Link to="/about" className="hover:text-accent">
            אודות ויצירת קשר
          </Link>
          <Link to="/terms" className="hover:text-accent">
            תנאי שימוש
          </Link>
          <Link to="/privacy" className="hover:text-accent">
            מדיניות פרטיות
          </Link>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-primary-foreground/55">
          <span>
            כל הזכויות שמורות לנוריאל מחשבים 2025 |{" "}
            <a href="https://nuriel-shop.co.il" dir="ltr" className="hover:text-accent">
              nuriel-shop.co.il
            </a>
          </span>
          <span dir="ltr">גרסה {APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
