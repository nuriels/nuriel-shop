import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteSettings } from "@/hooks/useSiteSettings";

/**
 * מצב תחזוקה: האתר חסום לאורחים וללקוחות, מנהלים וסוכנים ממשיכים לעבוד
 * (עדכון מלאי, מחירים והזמנות) כדי שאפשר יהיה לסדר דברים בשקט.
 */
export function MaintenanceScreen({ onSignOut }: { onSignOut?: () => void }) {
  const { settings } = useSiteSettings();
  const phone = settings?.support_phone?.trim() || settings?.business_phone?.trim() || "";

  return (
    <main className="surface-cellar flex flex-1 items-center justify-center px-4 py-20">
      <div className="max-w-lg text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Wrench className="size-7" />
        </span>
        <h1 className="font-display mt-5 text-2xl text-primary-foreground">
          {settings?.site_title ?? "האתר"} בעבודות תחזוקה
        </h1>
        <p className="mt-3 leading-7 text-primary-foreground/75">
          {settings?.maintenance_message?.trim() ||
            "האתר בשיפוצים ויחזור לפעילות בקרוב. לכל דבר דחוף אנחנו זמינים בטלפון."}
        </p>
        {phone && (
          <p className="mt-4">
            <a
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              dir="ltr"
              className="numeric text-lg font-semibold text-accent hover:underline"
            >
              {phone}
            </a>
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            asChild
            variant="outline"
            className="border-white/25 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          >
            <Link to="/login">התחברות לצוות</Link>
          </Button>
          {onSignOut && (
            <Button
              variant="ghost"
              onClick={onSignOut}
              className="text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
            >
              התנתקות
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
