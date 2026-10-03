import { useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Globe,
  Layers,
  LockKeyhole,
  Mail,
  Rocket,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalOnboarding } from "@/components/portal/PortalOnboarding";

/**
 * דף הנחיתה של הפלטפורמה — מוצג בעמוד הבית של nuriel-app2 במקום הקטלוג
 * (חלק 12). Hero עם הכפתור הראשי, מה מקבלים, איך זה עובד, וקריאה לפעולה
 * בסוף. כל כפתור פותח את תהליך הכניסה / פתיחת החנות (PortalOnboarding).
 */

const FEATURES = [
  {
    icon: Rocket,
    title: "באוויר תוך דקות",
    text: "שם לחנות, כתובת — וזהו. כתובת מאובטחת (SSL) ופאנל ניהול מוכנים מיד.",
  },
  {
    icon: ShoppingBag,
    title: "קטלוג וקופה חכמים",
    text: "מוצרים, וריאציות (מידה / צבע), מוצרים דיגיטליים עם רישיונות, ומבצעים בעגלה.",
  },
  {
    icon: Truck,
    title: "הזמנות ומשלוחים",
    text: "שיטות משלוח, איסוף עצמי, ליקוט במחסן, שליחים ומעקב סטטוס — במקום אחד.",
  },
  {
    icon: BarChart3,
    title: "לוח בקרה חי",
    text: "הכנסות החודש, הזמנות פתוחות ולקוחות חדשים — במבט אחד, מכל מכשיר.",
  },
  {
    icon: Globe,
    title: "הדומיין שלכם",
    text: "מתחילים בכתובת חינמית, ומחברים דומיין משלכם בכל רגע — עם תעודת אבטחה אוטומטית.",
  },
  {
    icon: Smartphone,
    title: "מושלם בנייד",
    text: "החנות והניהול בעברית מלאה, מותאמים לטלפון — הלקוחות קונים בקלות מכל מקום.",
  },
] as const;

const STEPS = [
  {
    icon: Mail,
    title: "מזינים אימייל",
    text: "מקבלים קוד חד-פעמי — בלי סיסמאות ובלי טפסים ארוכים.",
  },
  {
    icon: Store,
    title: "בוחרים שם וכתובת",
    text: "הכתובת באנגלית נוצרת לבד מהשם, ואפשר לשנות אותה.",
  },
  {
    icon: Sparkles,
    title: "מנהלים את החנות",
    text: "נכנסים ישר לפאנל הניהול: מוסיפים מוצרים, מעצבים ומתחילים למכור.",
  },
] as const;

export function PlatformLanding({ siteName }: { siteName: string }) {
  const [open, setOpen] = useState(false);
  const { hostMode } = useRouteContext({ from: "__root__" });
  const baseDomain = hostMode.baseDomain ?? "nuri1.fit";
  const start = () => setOpen(true);

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-background text-foreground">
      {/* כותרת עליונה */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 text-primary-foreground">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-md">
              <Layers className="size-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">{siteName}</span>
          </a>
          <Button
            type="button"
            variant="outline"
            onClick={start}
            className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground hover:text-primary"
          >
            <LockKeyhole className="size-4" />
            כניסה
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-primary text-primary-foreground">
          {/* רשת עדינה ואור ברקע */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:44px_44px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-accent/25 blur-3xl"
          />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-28 sm:px-6 md:pt-32 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28">
            <div className="text-center lg:text-right">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3.5 py-1.5 text-xs font-medium text-primary-foreground/90">
                <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
                פלטפורמת חנויות אונליין בעברית
              </span>
              <h1 className="mt-5 font-display text-4xl font-black leading-[1.15] sm:text-5xl lg:text-6xl">
                החנות החכמה שלך
                <br />
                <span className="text-accent">באוויר תוך דקות</span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-primary-foreground/80 sm:text-lg lg:mx-0">
                פותחים חנות אונליין מקצועית בלי מתכנתים ובלי לעצב מאפס: קטלוג, קופה, משלוחים, מוצרים
                דיגיטליים ולוח בקרה — הכל מוכן, בעברית, ומותאם לנייד.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button
                  type="button"
                  size="lg"
                  onClick={start}
                  className="h-14 w-full bg-accent px-8 text-base font-bold text-accent-foreground shadow-lg shadow-black/20 hover:bg-accent/90 sm:w-auto"
                >
                  התחבר או פתח חנות בחינם
                  <ArrowLeft className="size-5" />
                </Button>
                <a
                  href="#how"
                  className="text-sm font-medium text-primary-foreground/80 underline-offset-4 hover:text-primary-foreground hover:underline"
                >
                  איך זה עובד?
                </a>
              </div>

              <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-primary-foreground/75 lg:justify-start">
                {["בלי כרטיס אשראי", "כתובת מאובטחת מיד", "דומיין משלכם בהמשך"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-4 text-accent" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <StorePreview baseDomain={baseDomain} />
          </div>
        </section>

        {/* מה מקבלים */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">כל מה שחנות צריכה</h2>
            <p className="mt-3 text-muted-foreground">
              מתחילים קטן, גדלים בלי להחליף מערכת. הכלים של חנויות גדולות — בפשטות של כמה קליקים.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/5 text-primary transition group-hover:bg-accent group-hover:text-accent-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* איך זה עובד */}
        <section id="how" className="scroll-mt-6 border-y border-border bg-secondary/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 className="text-center font-display text-3xl font-bold sm:text-4xl">
              שלושה צעדים, וזהו
            </h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="relative rounded-2xl bg-card p-6 text-center shadow-sm">
                  <span className="absolute -top-3 right-1/2 flex size-7 translate-x-1/2 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground shadow">
                    {index + 1}
                  </span>
                  <span className="mx-auto mt-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* קריאה לפעולה */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground shadow-xl sm:px-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-accent/30 blur-3xl"
            />
            <h2 className="relative font-display text-3xl font-bold sm:text-4xl">
              החנות הבאה שתצליח יכולה להיות שלך
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-primary-foreground/80">
              פותחים עכשיו, בחינם, ומתחילים למכור עוד היום.
            </p>
            <Button
              type="button"
              size="lg"
              onClick={start}
              className="relative mt-8 h-14 bg-accent px-8 text-base font-bold text-accent-foreground hover:bg-accent/90"
            >
              התחבר או פתח חנות בחינם
              <ArrowLeft className="size-5" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span>
            © {new Date().getFullYear()} {siteName}
          </span>
          <nav className="flex gap-4">
            <a href="/terms" className="hover:text-foreground">
              תנאי שימוש
            </a>
            <a href="/privacy" className="hover:text-foreground">
              פרטיות
            </a>
          </nav>
        </div>
      </footer>

      <PortalOnboarding open={open} onOpenChange={setOpen} baseDomain={baseDomain} />
    </div>
  );
}

/** הדמיה של חנות + נתון מלוח הבקרה (ב-Hero) — רק עיצוב, בלי נתונים אמיתיים */
function StorePreview({ baseDomain }: { baseDomain: string }) {
  const products = [
    { name: "קפה קלוי טרי", price: "₪49", tone: "bg-amber-100" },
    { name: "ספל קרמיקה", price: "₪65", tone: "bg-emerald-100" },
    { name: "מארז מתנה", price: "₪149", tone: "bg-rose-100" },
    { name: "כרטיס מתנה", price: "₪100", tone: "bg-sky-100" },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto hidden w-full max-w-md sm:block">
      <div className="rotate-[-1.5deg] overflow-hidden rounded-2xl bg-card text-card-foreground shadow-2xl shadow-black/40 ring-1 ring-black/5">
        {/* שורת דפדפן */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/70 px-3 py-2.5">
          <span className="flex gap-1.5" dir="ltr">
            <span className="size-2.5 rounded-full bg-rose-400" />
            <span className="size-2.5 rounded-full bg-amber-400" />
            <span className="size-2.5 rounded-full bg-emerald-400" />
          </span>
          <span
            dir="ltr"
            className="mx-auto flex items-center gap-1 rounded-md bg-background px-3 py-0.5 text-[11px] text-muted-foreground"
          >
            <LockKeyhole className="size-3 text-emerald-600" />
            your-shop.{baseDomain}
          </span>
        </div>
        {/* החנות */}
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="font-display text-base font-bold">הקפה של דנה</span>
            <span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
              <ShoppingBag className="size-3" />
              העגלה (2)
            </span>
          </div>
          <div className="h-16 rounded-xl bg-gradient-to-l from-accent/80 to-accent/40 p-3 text-xs font-bold text-accent-foreground">
            משלוח חינם מעל ₪200 ✨
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {products.map((product) => (
              <div key={product.name} className="rounded-xl border border-border p-2">
                <div className={`h-14 rounded-lg ${product.tone}`} />
                <p className="mt-1.5 truncate text-[11px] font-medium">{product.name}</p>
                <p className="text-[11px] font-bold text-primary">{product.price}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* כרטיס מלוח הבקרה */}
      <div className="absolute -bottom-6 -right-4 w-44 rotate-[2deg] rounded-xl bg-card p-3 text-card-foreground shadow-xl ring-1 ring-black/5 sm:-right-8">
        <p className="text-[10px] text-muted-foreground">הכנסות החודש</p>
        <p className="text-lg font-bold">₪12,480</p>
        <p className="text-[10px] font-medium text-emerald-600">▲ 18% מהחודש הקודם</p>
        <div className="mt-2 flex h-8 items-end gap-1" dir="ltr">
          {[30, 45, 35, 60, 50, 75, 90].map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-sm bg-accent/70"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
