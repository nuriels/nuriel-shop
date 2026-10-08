import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { MoonStar } from "lucide-react";
import { useAuthState } from "@/hooks/useAuthState";
import { SabbathScreen } from "@/components/SabbathScreen";

/**
 * עמודים שפתוחים גם בשבת: אזורי הצוות, התחברות, עמוד השליח ועמודי מידע.
 * כל השאר (הקטלוג, ההזמנות, ההסכם) מוחלף במסך "שבת שלום".
 */
const OPEN_ON_SABBATH =
  /^\/(admin|admin-handoff|agent|warehouse|courier|login|register|reset-password|locked|forbidden|platform|about|terms|privacy|sitemap|pages)(\/|$)/;

/**
 * שער החנות: כשמצב שבת דולק, לקוחות ואורחים רואים מסך "שבת שלום" על כל
 * המסך — בלי קטלוג ובלי אפשרות לקנות (וגם במסד הזמנה חדשה נחסמת). צוות
 * החנות ממשיך לעבוד כרגיל, עם פס תזכורת.
 */
export function StorefrontGate({
  sabbath,
  storeName,
  children,
}: {
  sabbath: boolean;
  storeName: string;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  if (!sabbath || OPEN_ON_SABBATH.test(pathname)) return <>{children}</>;
  return <SabbathGate storeName={storeName}>{children}</SabbathGate>;
}

function SabbathGate({ storeName, children }: { storeName: string; children: ReactNode }) {
  const { role } = useAuthState();
  const isStaff =
    role?.role === "admin" ||
    role?.role === "agent" ||
    role?.role === "warehouse" ||
    role?.role === "cashier";
  // עד שידוע מי המשתמש (וגם ב-SSR) — מסך השבת, כדי שלקוח לא יראה את הקטלוג לרגע
  if (!isStaff) return <SabbathScreen storeName={storeName} />;
  return (
    <>
      <SabbathStaffBanner isAdmin={role?.role === "admin"} />
      {children}
    </>
  );
}

/** פס תזכורת לצוות: הלקוחות רואים כרגע את מסך השבת */
export function SabbathStaffBanner({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
      <MoonStar className="size-4 shrink-0" />
      <span>
        <strong>מצב שבת פעיל</strong> — לקוחות ואורחים רואים מסך "שבת שלום" ולא יכולים להזמין.
      </span>
      {isAdmin && (
        <Link to="/admin/settings" className="font-semibold underline underline-offset-2">
          לכיבוי בהגדרות
        </Link>
      )}
    </div>
  );
}
