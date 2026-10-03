import { useLoaderData, useRouteContext } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { UserRole } from "@/hooks/useAuthState";
import { DEFAULT_STORE_NAME } from "@/lib/branding";

/**
 * פס עליון כשמנהל-על מנהל חנות שהוא לא רשום בצוות שלה (God Mode) —
 * כדי שתמיד יהיה ברור באיזו חנות עובדים ואיך חוזרים לפאנל הפלטפורמה.
 */
export function GodModeBanner({ role }: { role: UserRole | null }) {
  const { hostMode } = useRouteContext({ from: "__root__" });
  const site = useLoaderData({ from: "__root__" });
  if (!role?.is_platform_admin || role.is_member !== false) return null;

  const storeName = site?.siteName || DEFAULT_STORE_NAME;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-violet-100 px-4 py-2 text-center text-sm text-violet-950">
      <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>מצב מנהל-על</strong> — ניהול "{storeName}" בהרשאות מלאות, בלי רישום בצוות החנות.
      </span>
      {hostMode.platformUrl && (
        <a href={hostMode.platformUrl} className="font-semibold underline underline-offset-2">
          חזרה לפאנל הפלטפורמה
        </a>
      )}
    </div>
  );
}
