import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Receipt,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountSettingsDialog } from "@/components/AccountSettingsDialog";
import { StaffNotificationsBell } from "@/components/StaffNotificationsBell";
import { StoreSwitcher } from "@/components/StoreSwitcher";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useCanGoBack } from "@/hooks/useBackToClose";
import type { UserRole } from "@/hooks/useAuthState";
import logo from "@/assets/logo";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { useStorefrontFrame } from "@/components/layout/storefront-frame";
import { cn } from "@/lib/utils";

/**
 * כותרת האתר: פס "מרתף" כהה שמחזיק את הלוגו, הניווט וסל ההזמנה.
 * הרקע הכהה מפריד בבירור בין המיתוג לבין הקטלוג הבהיר שמתחתיו.
 */
export function SiteHeader({
  role,
  email,
  onSignOut,
  cartCount,
  onOpenCart,
  wide = false,
  search = false,
}: {
  role: UserRole | null;
  email: string | null;
  onSignOut?: () => void;
  cartCount?: number;
  onOpenCart?: () => void;
  /** המסגרת הרחבה של חזית החנות — מיושרת לתוכן (StorefrontMain width="wide") */
  wide?: boolean;
  /** שורת חיפוש בכותרת (במחשב, lg+) — בחזית החנות */
  search?: boolean;
}) {
  const { settings, logoUrl } = useSiteSettings();
  const frame = useStorefrontFrame(wide);
  const site = useLoaderData({ from: "__root__" });
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const title = settings?.site_title?.trim() || site?.siteName || DEFAULT_STORE_NAME;
  // הלוגו המובנה שייך לחנות הראשית; חנות בלי לוגו מקבלת את האות הראשונה של שמה
  const logoSrc = logoUrl ?? (site?.isDefaultStore ? logo.url : null);

  // הגובה האמיתי של הכותרת (משתנה כשהיא נשברת לשתי שורות בטלפון) — כדי שאלמנטים
  // "דביקים" מתחתיה (תפריט הניהול, פס השמירה בהגדרות) ייעצרו בדיוק מתחתיה
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--site-header-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const navLinkClass =
    "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-primary-foreground/75 transition-colors hover:bg-white/10 hover:text-primary-foreground";
  const navActiveClass = "bg-white/12 text-primary-foreground";

  return (
    <header ref={headerRef} className="surface-cellar sticky top-0 z-30 shadow-soft">
      <div className={cn("mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", frame)}>
        {canGoBack && (
          // חזרה למסך הקודם באתר (לשונית / קטגוריה / חלון) — בלי רענון ובלי לאבד מה שנעשה
          <button
            type="button"
            onClick={() => router.history.back()}
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary-foreground/80 transition-colors hover:bg-white/10 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-3"
            aria-label="חזרה למסך הקודם"
          >
            <ChevronRight className="size-5" />
            <span className="hidden sm:inline">חזרה</span>
          </button>
        )}
        <Link to="/" className="flex min-w-0 items-center gap-3">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={title}
              className="h-10 w-auto max-w-32 shrink-0 rounded-md bg-white/95 object-contain p-1 sm:h-11"
            />
          ) : (
            <span
              aria-hidden="true"
              className="font-display grid size-10 shrink-0 place-items-center rounded-md bg-primary-foreground text-xl font-bold text-primary sm:size-11"
            >
              {title.trim().charAt(0)}
            </span>
          )}
          <span className="font-display hidden truncate text-lg text-primary-foreground sm:block">
            {title}
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:mr-2">
          {role?.role !== "warehouse" && role?.role !== "cashier" && (
            <Link
              to="/"
              activeOptions={{ exact: true }}
              className={navLinkClass}
              activeProps={{ className: navActiveClass }}
            >
              <Store className="size-4" />
              <span className="hidden sm:inline">קטלוג</span>
            </Link>
          )}
          {/* חלק 33: מסך הבית של המחסנאי / הקופאי בפאנל */}
          {role?.role === "warehouse" && (
            <Link
              to="/admin"
              search={{ tab: "picking" }}
              className={navLinkClass}
              activeProps={{ className: "" }}
            >
              <ClipboardList className="size-4" />
              מחסן
            </Link>
          )}
          {role?.role === "cashier" && (
            <Link
              to="/admin"
              search={{ tab: "pos" }}
              className={navLinkClass}
              activeProps={{ className: "" }}
            >
              <Receipt className="size-4" />
              קופה
            </Link>
          )}
          {/* האזור האישי (הזמנות + הפרטים שלי) — גלוי תמיד ללקוח מחובר, גם במובייל */}
          {role?.role === "customer" && (
            <Link
              to="/account"
              className={navLinkClass}
              activeProps={{ className: navActiveClass }}
            >
              <UserRound className="size-4" />
              <span className="hidden sm:inline">האזור האישי</span>
              <span className="sm:hidden">החשבון</span>
            </Link>
          )}
          {(role?.role === "agent" || role?.role === "admin") && (
            <Link
              to={role.role === "admin" ? "/admin" : "/agent"}
              search={{ tab: "orders" }}
              className={navLinkClass}
              activeProps={{ className: "" }}
            >
              <ClipboardList className="size-4" />
              הזמנות
            </Link>
          )}
          {role?.role === "agent" && (
            <Link to="/agent" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              <LayoutDashboard className="size-4" />
              <span className="hidden sm:inline">פאנל סוכן</span>
            </Link>
          )}
          {role?.role === "admin" && (
            <Link to="/admin" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              <ShieldCheck className="size-4" />
              <span className="hidden sm:inline">ניהול</span>
            </Link>
          )}
        </nav>

        {search && <HeaderSearch />}

        <div className="flex flex-1 items-center justify-end gap-2">
          {onOpenCart && (
            <Button
              size="sm"
              onClick={onOpenCart}
              aria-label={cartCount ? `הסל שלי (${cartCount} פריטים)` : "הסל שלי"}
              className="relative bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <ShoppingCart className="size-4" />
              <span className="hidden sm:inline">הסל שלי</span>
              {!!cartCount && (
                <Badge className="absolute -left-2 -top-2 size-5 justify-center rounded-full border-0 bg-white p-0 text-[11px] font-bold text-accent">
                  {cartCount}
                </Badge>
              )}
            </Button>
          )}
          {email ? (
            <>
              {/* חלק 18ב: איש צוות שמשויך לכמה חנויות — מעבר בין החנויות */}
              {(role?.role === "admin" ||
                role?.role === "agent" ||
                role?.role === "warehouse" ||
                role?.role === "cashier") && <StoreSwitcher userId={role.user_id} />}
              {(role?.role === "agent" || role?.role === "admin") && (
                <StaffNotificationsBell userId={role.user_id} />
              )}
              <span
                dir="ltr"
                className="hidden max-w-[24vw] truncate text-sm text-primary-foreground/70 lg:block"
              >
                {email}
              </span>
              {role && (
                <AccountSettingsDialog userId={role.user_id} currentUsername={role.username} />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onSignOut}
                className="border-white/25 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">התנתקות</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.navigate({ to: "/login" })}
                className="text-primary-foreground/85 hover:bg-white/10 hover:text-primary-foreground"
              >
                התחברות
              </Button>
              <Button
                size="sm"
                onClick={() => router.navigate({ to: "/register" })}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                פתיחת חשבון
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * חיפוש בכותרת (במחשב). עובד על אותו חיפוש של הקטלוג (?q= בעמוד הבית): בעמוד הבית
 * הקטלוג מסתנן תוך כדי הקלדה; Enter (מכל עמוד) עובר לתוצאות בקטלוג.
 */
function HeaderSearch() {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const onHome = location.pathname === "/";
  const rawQuery = (location.search as { q?: unknown }).q;
  const urlQuery = onHome && typeof rawQuery === "string" ? rawQuery : "";
  const [value, setValue] = useState(urlQuery);
  const lastQuery = useRef(urlQuery);

  // שינוי מבחוץ (שורת החיפוש שבקטלוג / חזור בדפדפן) — מתעדכן גם כאן
  useEffect(() => {
    if (urlQuery === lastQuery.current) return;
    lastQuery.current = urlQuery;
    setValue(urlQuery);
  }, [urlQuery]);

  // בעמוד הבית — סינון תוך כדי הקלדה (אחרי רגע קצר, כדי לא לעדכן בכל אות)
  useEffect(() => {
    if (!onHome) return;
    const next = value.trim() === "" ? "" : value;
    if (next === lastQuery.current) return;
    const timer = window.setTimeout(() => {
      lastQuery.current = next;
      void navigate({
        to: "/",
        search: (prev) => ({ ...prev, q: next === "" ? undefined : next }),
        replace: true,
        resetScroll: false,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, onHome, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const query = value.trim();
    lastQuery.current = query;
    await navigate({
      to: "/",
      search: (prev) => ({ ...(onHome ? prev : {}), q: query === "" ? undefined : query }),
      resetScroll: false,
    });
    // לתוצאות — אזור הקטלוג (מתחת לבאנרים ולמבצעים)
    window.requestAnimationFrame(() =>
      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <form
      role="search"
      onSubmit={(event) => void submit(event)}
      className="relative hidden min-w-48 max-w-md flex-1 lg:block"
      data-testid="header-search"
    >
      <Search
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="חיפוש מוצר לפי שם, מקט או ברקוד"
        aria-label="חיפוש מוצרים בחנות"
        className="h-10 w-full rounded-md border border-white/20 bg-white pl-3 pr-9 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </form>
  );
}
