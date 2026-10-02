import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  redirect,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AccessibilityWidget } from "@/components/AccessibilityWidget";
import { Toaster } from "@/components/ui/sonner";
import { hostMode, PLATFORM_PATHS } from "@/lib/host-mode";
import { SUSPENDED_ALLOWED_PATHS } from "@/lib/blocked-pages";
import { DEFAULT_STORE_NAME, getSiteSeo } from "@/lib/platform.functions";
import { brandThemeCss, normalizeBrandColor } from "@/lib/brand-theme";
import { StorefrontGate } from "@/components/StorefrontGate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // הפרדת ממשקים לפי דומיין: בדומיין של פאנל הפלטפורמה רק /platform (ו-login),
  // ובאתרי החנויות /platform לא קיים. רץ גם ב-SSR וגם בכל ניווט בדפדפן.
  beforeLoad: async ({ location }) => {
    const mode = await hostMode();
    if (mode.platform && !PLATFORM_PATHS.test(location.pathname)) {
      throw redirect({ to: "/platform" });
    }
    // מנהל חנות (או כל אחד) שמקליד /platform בדומיין של חנות — 403
    if (!mode.platform && /^\/platform(\/|$)/.test(location.pathname)) {
      throw redirect({ to: "/forbidden" });
    }
    // חנות מוקפאת: הלקוחות רואים רק את עמוד הנעילה; פאנל הניהול של החנות פתוח
    if (mode.suspended && !SUSPENDED_ALLOWED_PATHS.test(location.pathname)) {
      throw redirect({ to: "/locked" });
    }
    return { hostMode: mode };
  },
  // שם האתר ל-SEO, צבע המותג ומצב שבת: נטענים פעם אחת לטעינת עמוד (גם ב-SSR,
  // בלי הבהוב), ומתרעננים ברענון העמוד או אחרי שמירת ההגדרות (router.invalidate)
  loader: () => getSiteSeo(),
  staleTime: Infinity,
  head: ({ loaderData }) => {
    // חנות בלי שם עסק מוגדר → "החנות שלי"; דומיין הניהול → שם קבוע (מהשרת)
    const siteName = loaderData?.siteName || DEFAULT_STORE_NAME;
    // צבע המותג של החנות → משתני העיצוב (כותרת, פוטר, כפתורים ראשיים)
    const brandColor = normalizeBrandColor(loaderData?.brandColor);
    const brandCss = brandThemeCss(brandColor);
    return {
      styles: brandCss ? [{ children: brandCss }] : [],
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        // מה שמוצג בשיתוף קישור (ווטסאפ / רשתות) ובתוצאות חיפוש
        { title: siteName },
        { name: "description", content: siteName },
        { property: "og:title", content: siteName },
        { property: "og:description", content: siteName },
        { property: "og:site_name", content: siteName },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: "he_IL" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: siteName },
        { name: "twitter:description", content: siteName },
        // צבע שורת הדפדפן בטלפון
        ...(brandColor ? [{ name: "theme-color", content: brandColor }] : []),
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&family=Frank+Ruhl+Libre:wght@500;700;900&display=swap",
        },
      ],
    };
  },

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const site = Route.useLoaderData();

  return (
    <QueryClientProvider client={queryClient}>
      {/* מצב שבת: לקוחות ואורחים רואים "שבת שלום" במקום עמודי החנות */}
      <StorefrontGate
        sabbath={site?.sabbath === true}
        storeName={site?.siteName || DEFAULT_STORE_NAME}
      >
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </StorefrontGate>
      <AccessibilityWidget />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
