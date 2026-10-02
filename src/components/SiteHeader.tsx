import { Link, useRouter } from "@tanstack/react-router";
import {
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  ShoppingCart,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountSettingsDialog } from "@/components/AccountSettingsDialog";
import { StaffNotificationsBell } from "@/components/StaffNotificationsBell";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useCanGoBack } from "@/hooks/useBackToClose";
import type { UserRole } from "@/hooks/useAuthState";
import logo from "@/assets/logo";

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
}: {
  role: UserRole | null;
  email: string | null;
  onSignOut?: () => void;
  cartCount?: number;
  onOpenCart?: () => void;
}) {
  const { settings, logoUrl } = useSiteSettings();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const title = settings?.site_title ?? "סוכנות המשקאות";

  const navLinkClass =
    "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-primary-foreground/75 transition-colors hover:bg-white/10 hover:text-primary-foreground";
  const navActiveClass = "bg-white/12 text-primary-foreground";

  return (
    <header className="surface-cellar sticky top-0 z-30 shadow-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
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
          <img
            src={logoUrl ?? logo.url}
            alt={title}
            className="h-10 w-auto max-w-32 shrink-0 rounded-md bg-white/95 object-contain p-1 sm:h-11"
          />
          <span className="font-display hidden truncate text-lg text-primary-foreground sm:block">
            {title}
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:mr-2">
          {role?.role !== "warehouse" && (
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
          {role?.role === "warehouse" && (
            <Link
              to="/warehouse"
              className={navLinkClass}
              activeProps={{ className: navActiveClass }}
            >
              <ClipboardList className="size-4" />
              ליקוט
            </Link>
          )}
          {/* לשונית מהירה להזמנות — גלויה תמיד למשתמש מחובר, גם במובייל */}
          {role?.role === "customer" && (
            <Link to="/orders" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              <ClipboardList className="size-4" />
              הזמנות
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

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {onOpenCart && (
            <Button
              size="sm"
              onClick={onOpenCart}
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
              {(role?.role === "agent" || role?.role === "admin") && (
                <StaffNotificationsBell userId={role.user_id} />
              )}
              <span
                dir="ltr"
                className="hidden max-w-[24vw] truncate text-sm text-primary-foreground/70 md:block"
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
