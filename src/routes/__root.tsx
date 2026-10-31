import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  redirect,
  type ErrorComponentProps,
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
import { RestBanner } from "@/components/RestBanner";
import { RestStateProvider } from "@/components/RestStateProvider";
import { MarketingLayer } from "@/components/marketing/MarketingLayer";
import { CartProvider } from "@/hooks/useCart";
import { TrackingConsent } from "@/components/marketing/TrackingConsent";
import { canonicalUrl } from "@/lib/seo-urls";
import { EngineSiteShell } from "@/app/site-shell";
import { engineRouteRedirect } from "@/app/site-routes";

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

function ErrorComponent({ error, reset }: ErrorComponentProps) {
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
    // אתר של מנוע אחר (Hospitality): רק הנתיבים שהמנוע מגיש — השאר מופנים (בלי נעילת החנויות)
    if (mode.siteType !== "ecommerce") {
      const target = engineRouteRedirect(mode.siteType, location.pathname);
      if (target) throw redirect({ href: target });
      return { hostMode: mode };
    }
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
  head: ({ loaderData, matches }) => {
    // חנות בלי שם עסק מוגדר → "החנות שלי"; דומיין הניהול → שם קבוע (מהשרת)
    const siteName = loaderData?.siteName || DEFAULT_STORE_NAME;
    // SEO (חלק 14): הכותרת והתיאור מ"שיווק ואינטגרציות" — ואם ריקים, שם העסק
    const title = loaderData?.seoTitle || siteName;
    const description = loaderData?.seoDescription || siteName;
    // צבע המותג של החנות → משתני העיצוב (כותרת, פוטר, כפתורים ראשיים)
    const brandColor = normalizeBrandColor(loaderData?.brandColor);
    const brandCss = brandThemeCss(brandColor);
    // חלק 40: Facebook Pixel / Google Analytics לא נטענים כאן (ב-SSR) — רק
    // בדפדפן, אחרי שהגולש אישר עוגיות (TrackingConsent)
    const path = matches[matches.length - 1]?.pathname ?? "/";
    // חלק 31: כתובת קנונית אחת לכל עמוד ציבורי — מהכתובת הרשמית של החנות (דומיין
    // אישי פעיל, אחרת הסאב-דומיין), לא מהדומיין שממנו נכנסו. נוצרת בשרת (SSR).
    // עמוד מוצר ועמוד תוכן מוסיפים אותה בעצמם (רק כשהעמוד באמת קיים); אזורים
    // פרטיים — בלי.
    // (ב-head של ה-root הטיפוס מכיר רק את ה-root — העמוד עצמו הוא ה-match האחרון)
    const leaf = matches[matches.length - 1] as { search?: unknown } | undefined;
    const canonical = /^\/(product|pages)\//.test(path)
      ? null
      : canonicalUrl(
          loaderData?.schema?.url,
          path,
          (leaf?.search ?? null) as Record<string, unknown> | null,
        );
    return {
      styles: brandCss ? [{ children: brandCss }] : [],
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        // מה שמוצג בשיתוף קישור (ווטסאפ / רשתות) ובתוצאות חיפוש
        { title },
        { name: "description", content: description },
        ...(loaderData?.seoKeywords ? [{ name: "keywords", content: loaderData.seoKeywords }] : []),
        // אימות בעלות ב-Google Search Console (שיווק ואינטגרציות) — לכל חנות בנפרד
        ...(loaderData?.googleVerification
          ? [{ name: "google-site-verification", content: loaderData.googleVerification }]
          : []),
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: siteName },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: "he_IL" },
        ...(canonical ? [{ property: "og:url", content: canonical }] : []),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        // חלק 21: תמונת השיתוף — הלוגו של החנות (בעמוד מוצר: תמונת המוצר)
        // חלק 24: PNG מהלוגו מהדומיין של החנות (אם יש כתובת אתר); אחרת — כמו קודם
        ...(loaderData?.shareImage
          ? [
              { property: "og:image", content: loaderData.shareImage },
              { name: "twitter:image", content: loaderData.shareImage },
            ]
          : loaderData?.schema?.logoUrl
            ? [
                { property: "og:image", content: loaderData.schema.logoUrl },
                { name: "twitter:image", content: loaderData.schema.logoUrl },
              ]
            : []),
        // צבע שורת הדפדפן בטלפון
        ...(brandColor ? [{ name: "theme-color", content: brandColor }] : []),
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        ...(canonical ? [{ rel: "canonical", href: canonical }] : []),
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        // חלק 24: אייקון "הוספה למסך הבית" — מהלוגו של החנות (אייפון: 180; אנדרואיד: 192)
        ...(loaderData?.appleIcon
          ? [
              { rel: "apple-touch-icon", sizes: "180x180", href: loaderData.appleIcon },
              {
                rel: "icon",
                type: "image/png",
                sizes: "192x192",
                href: loaderData.appleIcon.replace("apple-touch-icon", "icon-192"),
              },
            ]
          : []),
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
        {/* חלק 40: נגישות — "דלג לתוכן" (מופיע בלחיצת Tab הראשונה) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:right-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
          onClick={(event) => {
            const main = document.querySelector("main");
            if (!main) return;
            event.preventDefault();
            if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
            main.focus();
            main.scrollIntoView();
          }}
          data-testid="skip-link"
        >
          דלג לתוכן הראשי
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, hostMode: mode } = Route.useRouteContext();
  const site = Route.useLoaderData();

  // אתר של מנוע אחר (Hospitality): המעטפת של המנוע, בלי הסל, מצב שבת, פופ-אפ ומעקב של החנויות
  if (mode.siteType !== "ecommerce") {
    return (
      <QueryClientProvider client={queryClient}>
        <EngineSiteShell siteType={mode.siteType}>
          <Outlet />
        </EngineSiteShell>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* הסל משותף לכל העמודים (קטלוג → קופה) ונשמר בדפדפן */}
      <CartProvider>
        {/* חלק 35: שמירת שבת וחג אוטומטית — גלישה פתוחה, סל וקופה נעולים */}
        <RestStateProvider settings={site?.rest ?? null}>
          {/* מצב שבת: לקוחות ואורחים רואים "שבת שלום" במקום עמודי החנות */}
          <StorefrontGate
            sabbath={site?.sabbath === true}
            storeName={site?.siteName || DEFAULT_STORE_NAME}
          >
            <RestBanner />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </StorefrontGate>
        </RestStateProvider>
        {/* פופ-אפ המבצעים ומעקב מעברי עמוד (Pixel) — חלק 14 */}
        <MarketingLayer
          promo={site?.promo ?? null}
          tracking={site?.tracking ?? null}
          sabbath={site?.sabbath === true}
        />
        {/* חלק 40: Pixel / Analytics רק אחרי הסכמה לעוגיות */}
        <TrackingConsent tracking={site?.tracking ?? null} />
      </CartProvider>
      <AccessibilityWidget />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
