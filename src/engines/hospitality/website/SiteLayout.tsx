// המעטפת של האתר הציבורי (/stay): הערכה (משתני CSS), הטקסטים לפי שפה, הכותרת, הפוטר עם
// קרדיט נוריאל (D6 — מחוץ לתוכן, לא ניתן להסרה) ושורת פעולות קבועה בנייד.
import { Link, Outlet, useLoaderData, useLocation } from "@tanstack/react-router";
import { Mail, Menu, MessageCircle, Phone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NurielCredit } from "@/platform/branding/NurielCredit";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger, cn } from "@/platform/ui";
import type { PublicSite } from "../types/website";
import { CopyContext, siteCopy, useCopy } from "./copy";
import { findUnit, telHref, whatsappHref } from "./lib/format";
import { SiteContext, useSite } from "./lib/site-context";
import { DEFAULT_THEME, themeFor, themeStyle } from "./theme/themes";

/** עמודים שמתחילים בתמונה גדולה (הבית, יחידה קיימת) — הכותרת שקופה מעליה עד שגוללים */
function isHeroPage(pathname: string, site: PublicSite): boolean {
  if (/^\/stay\/?$/.test(pathname)) return true;
  const unit = pathname.match(/^\/stay\/units\/([^/]+)\/?$/);
  return !!unit && !!findUnit(site.units, unit[1]);
}

export function SiteLayout(): ReactNode {
  const site = useLoaderData({ strict: false }) as PublicSite;
  const theme = themeFor(DEFAULT_THEME);
  const copy = siteCopy("he");
  return (
    <CopyContext.Provider value={copy}>
      <SiteContext.Provider value={{ site, theme }}>
        <div
          dir={copy.dir}
          lang={copy.locale}
          style={themeStyle(theme)}
          className="min-h-screen bg-background font-sans text-foreground antialiased"
          data-site-theme={theme.id}
        >
          <a
            href="#main"
            className="sr-only z-[60] rounded-sm bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
          >
            {copy.nav.skip}
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1} className="pb-20 outline-none md:pb-0">
            <Outlet />
          </main>
          <SiteFooter />
          <MobileActionBar />
        </div>
      </SiteContext.Provider>
    </CopyContext.Provider>
  );
}

function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

function navItems(t: ReturnType<typeof useCopy>) {
  return [
    { hash: "units", label: t.nav.units },
    { hash: "gallery", label: t.nav.gallery },
    { hash: "amenities", label: t.nav.amenities },
    { hash: "terms", label: t.nav.terms },
    { hash: "location", label: t.nav.location },
    { hash: "contact", label: t.nav.contact },
  ];
}

function SiteHeader() {
  const t = useCopy();
  const { site, theme } = useSite();
  const { pathname } = useLocation();
  const scrolled = useScrolled();
  const overlay = theme.layout.overlayHeader && isHeroPage(pathname, site) && !scrolled;
  const items = navItems(t);
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,color] duration-300",
        overlay
          ? "bg-gradient-to-b from-black/45 to-transparent text-white"
          : "border-b border-border/70 bg-background/92 text-foreground shadow-[0_1px_0_0_transparent] backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:h-20 sm:px-8">
        <Link
          to="/stay"
          className="font-display truncate text-xl font-medium tracking-wide sm:text-2xl"
          aria-label={`${site.business.name} — ${t.nav.home}`}
        >
          {site.business.name}
        </Link>
        <nav aria-label={t.nav.menu} className="hidden items-center gap-7 text-sm lg:flex">
          {items.map((i) => (
            <Link
              key={i.hash}
              to="/stay"
              hash={i.hash}
              className={cn(
                "relative py-1 transition-opacity hover:opacity-100",
                overlay ? "opacity-90" : "opacity-80",
                "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-center after:scale-x-0 after:bg-current after:transition-transform hover:after:scale-x-100",
              )}
            >
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {site.business.phone && (
            <a
              href={telHref(site.business.phone)}
              className={cn(
                "hidden items-center gap-2 rounded-sm border px-4 py-2 text-sm transition-colors md:inline-flex",
                overlay
                  ? "border-white/50 hover:bg-white/10"
                  : "border-foreground/20 hover:bg-foreground/5",
              )}
            >
              <Phone className="size-4" aria-hidden="true" />
              <span dir="ltr">{site.business.phone}</span>
            </a>
          )}
          <Sheet>
            <SheetTrigger
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-sm lg:hidden",
                overlay ? "hover:bg-white/10" : "hover:bg-foreground/5",
              )}
              aria-label={t.nav.menu}
            >
              <Menu className="size-6" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[85vw] max-w-sm border-s-0 bg-background p-0"
              style={themeStyle(theme)}
              dir={t.dir}
            >
              <SheetTitle className="font-display border-b border-border px-6 py-5 text-xl font-medium">
                {site.business.name}
              </SheetTitle>
              <nav aria-label={t.nav.menu} className="flex flex-col px-3 py-4">
                <SheetClose asChild>
                  <Link to="/stay" className="rounded-sm px-3 py-3 text-lg hover:bg-muted">
                    {t.nav.home}
                  </Link>
                </SheetClose>
                {items.map((i) => (
                  <SheetClose asChild key={i.hash}>
                    <Link
                      to="/stay"
                      hash={i.hash}
                      className="rounded-sm px-3 py-3 text-lg hover:bg-muted"
                    >
                      {i.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <ContactButtons className="border-t border-border px-6 py-5" />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function ContactButtons({ className }: { className?: string }) {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
      {b.phone && (
        <a href={telHref(b.phone)} className="inline-flex items-center gap-3 hover:underline">
          <Phone className="size-4 text-[var(--site-gold-ink)]" aria-hidden="true" />
          <span dir="ltr">{b.phone}</span>
        </a>
      )}
      {(b.whatsapp || b.phone) && (
        <a
          href={whatsappHref((b.whatsapp || b.phone)!)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-3 hover:underline"
        >
          <MessageCircle className="size-4 text-[var(--site-gold-ink)]" aria-hidden="true" />
          {t.contact.whatsapp}
        </a>
      )}
      {b.email && (
        <a href={`mailto:${b.email}`} className="inline-flex items-center gap-3 hover:underline">
          <Mail className="size-4 text-[var(--site-gold-ink)]" aria-hidden="true" />
          <span dir="ltr">{b.email}</span>
        </a>
      )}
    </div>
  );
}

function SiteFooter() {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const year = Number(site.today.slice(0, 4)) || new Date().getFullYear();
  return (
    <footer className="bg-[var(--site-deep)] text-[var(--site-deep-foreground)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-8 md:grid-cols-3">
        <div>
          <p className="font-display text-2xl font-medium">{b.name}</p>
          {b.address && <p className="mt-3 text-sm opacity-75">{b.address}</p>}
        </div>
        <nav aria-label={t.nav.menu} className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {navItems(t).map((i) => (
            <Link key={i.hash} to="/stay" hash={i.hash} className="opacity-75 hover:opacity-100">
              {i.label}
            </Link>
          ))}
        </nav>
        <ContactButtons className="[&_svg]:text-[var(--site-gold)]" />
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs opacity-70 sm:flex-row sm:px-8">
          <p>{t.footer.rights(b.name, year)}</p>
          <NurielCredit />
        </div>
      </div>
    </footer>
  );
}

/** בנייד: חיוג, WhatsApp ומעבר ליחידות — תמיד בהישג יד */
function MobileActionBar() {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const wa = b.whatsapp || b.phone;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
      <div className="flex items-center gap-2">
        {b.phone && (
          <a
            href={telHref(b.phone)}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-sm border border-border"
            aria-label={`${t.contact.call} ${b.phone}`}
          >
            <Phone className="size-5" aria-hidden="true" />
          </a>
        )}
        {wa && (
          <a
            href={whatsappHref(wa)}
            target="_blank"
            rel="noopener"
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-sm border border-border"
            aria-label={t.contact.whatsapp}
          >
            <MessageCircle className="size-5" aria-hidden="true" />
          </a>
        )}
        <Link
          to="/stay"
          hash="units"
          className="inline-flex h-12 flex-1 items-center justify-center rounded-sm bg-primary text-base font-medium text-primary-foreground"
        >
          {t.hero.cta}
        </Link>
      </div>
    </div>
  );
}
