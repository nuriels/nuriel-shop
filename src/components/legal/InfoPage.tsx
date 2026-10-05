import type { ReactNode } from "react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { cn } from "@/lib/utils";

/**
 * מעטפת לעמודי המידע הציבוריים (תקנון, פרטיות, אודות, צור קשר, ביטול
 * עסקה, מפת האתר): כותרת האתר, כותרת העמוד ותחתית האתר.
 */
export function InfoPage({
  title,
  icon,
  intro,
  wide = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  intro?: ReactNode;
  /** שתי עמודות (צור קשר, מפת האתר) */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <main
        className={cn(
          "mx-auto w-full flex-1 space-y-5 px-4 py-6",
          wide ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground [&_svg]:size-6 [&_svg]:text-primary">
            {icon}
            {title}
          </h1>
          {intro && <p className="text-sm leading-6 text-muted-foreground">{intro}</p>}
        </header>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

export function LoadingLine() {
  return <p className="text-sm text-muted-foreground">טוען...</p>;
}
