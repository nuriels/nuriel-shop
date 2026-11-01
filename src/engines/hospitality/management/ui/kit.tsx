// ערכת הרכיבים של אזור הניהול (שלב F2): כותרת עמוד, כרטיס מקטע, תגית מצב, אייקון בריבוע, מגמה,
// מיני-גרף, פס התקדמות שמתמלא מהצד הנכון ב-RTL, ומצבים: ריק / שגיאה / אין הרשאה / טעינה.
// הכול מעל הטוקנים של manage.css; בלי שינוי ברכיבים המשותפים לחנויות.
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpLeft,
  ChevronRight,
  LockKeyhole,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, cn } from "@/platform/ui";
import { TONES, type Tone } from "./tones";

// ---------- כותרת עמוד ----------

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  back,
  display = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** קישור חזרה (למשל ממסך פרטים לרשימה) */
  back?: { to: string; label: string };
  /** כותרת בסריף (Frank Ruhl Libre) — לברכה בלוח הבקרה */
  display?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4" data-rise="">
      <div className="min-w-0">
        {back && (
          <Link
            to={back.to}
            className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--hm-lagoon-500)] hover:underline"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="text-[13px] text-muted-foreground">{eyebrow}</div>}
        <h1
          className={cn(
            "mt-1 text-[1.75rem] leading-tight font-bold text-[var(--hm-lagoon-900)]",
            display && "font-display text-[2.15rem] sm:text-[2.4rem]",
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------- כרטיס מקטע ----------

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  headingLevel = 2,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card shadow-[var(--hm-shadow-card)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            {title && <Heading className="text-base font-bold">{title}</Heading>}
            {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("px-5 pt-4 pb-5 sm:px-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------- תגית מצב ----------

export function StatusPill({
  tone,
  children,
  dot = true,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        t.bg,
        t.text,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

// ---------- אייקון בריבוע ----------

export function IconTile({
  icon: Icon,
  tone = "brand",
  size = "md",
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const t = TONES[tone];
  const box =
    size === "sm"
      ? "size-8 rounded-lg"
      : size === "lg"
        ? "size-11 rounded-xl"
        : "size-9 rounded-[10px]";
  const glyph = size === "sm" ? "size-4" : size === "lg" ? "size-5" : "size-[18px]";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center", box, t.bg, t.text)}
    >
      <Icon className={glyph} strokeWidth={1.8} />
    </span>
  );
}

// ---------- מגמה מול התקופה הקודמת ----------

/**
 * value — שינוי באחוזים (או בנקודות אחוז כש-unit="pp"); null — אין נתון להשוואה.
 * inverse — כשעלייה היא רעה (למשל ביטולים).
 */
export function TrendBadge({
  value,
  unit = "%",
  inverse = false,
}: {
  value: number | null;
  unit?: "%" | "pp";
  inverse?: boolean;
}) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--hm-neutral-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--hm-neutral)]">
        אין השוואה
      </span>
    );
  }
  const rounded =
    Math.abs(value) >= 10 || unit === "pp" ? Math.round(value) : Math.round(value * 10) / 10;
  const flat = rounded === 0;
  const good = flat ? null : rounded > 0 !== inverse;
  const tone: Tone = good === null ? "neutral" : good ? "success" : "danger";
  const Icon = rounded >= 0 ? ArrowUpLeft : ArrowDownLeft;
  const t = TONES[tone];
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
        t.bg,
        t.text,
      )}
    >
      {!flat && <Icon className="size-3.5" aria-hidden="true" />}
      <span dir="ltr" data-num="">
        {sign}
        {Math.abs(rounded)}
        {unit === "%" ? "%" : ""}
      </span>
      {unit === "pp" && <span>נק׳</span>}
      <span className="sr-only">{good === null ? "ללא שינוי" : good ? "שיפור" : "ירידה"}</span>
    </span>
  );
}

// ---------- מיני-גרף ----------

/** קו קטן; ב-RTL הזמן רץ מימין לשמאל (הערך החדש בצד שמאל) */
export function Sparkline({
  values,
  className,
  color = "var(--hm-lagoon-700)",
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  if (values.length < 2) return null;
  const W = 92;
  const H = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = W - (i / (values.length - 1)) * W;
      const y = H - 3 - ((v - min) / span) * (H - 6);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn("shrink-0", className)}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------- פס התקדמות ----------

/** פס התקדמות שמתמלא מתחילת השורה (מימין ב-RTL) — ה-Progress המשותף מתמלא תמיד משמאל */
export function MeterBar({
  value,
  label,
  tone = "brand",
  className,
}: {
  value: number;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const fill =
    tone === "champagne"
      ? "bg-[var(--hm-champagne-600)]"
      : tone === "brand"
        ? "bg-[var(--hm-lagoon-700)]"
        : TONES[tone].dot;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[var(--hm-line-soft)]", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------- מצבים ----------

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-[var(--hm-surface-2)] px-6 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-700)]"
      >
        <Icon className="size-6" strokeWidth={1.7} />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "המידע לא נטען",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--hm-danger-bg)] bg-[#fffaf8] px-4 py-3",
        className,
      )}
    >
      <TriangleAlert className="size-5 shrink-0 text-[var(--hm-danger)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--hm-danger)]">{title}</p>
        {message && <p className="text-[13px] text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          לנסות שוב
        </Button>
      )}
    </div>
  );
}

export function NoAccess({ text = "למסך הזה צריך הרשאה שאין לחשבון שלכם." }: { text?: string }) {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-10 text-center shadow-[var(--hm-shadow-card)]">
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--hm-champagne-100)] text-[var(--hm-champagne-700)]"
      >
        <LockKeyhole className="size-6" strokeWidth={1.7} />
      </span>
      <h1 className="text-lg font-bold">אין הרשאה למסך הזה</h1>
      <p className="text-sm text-muted-foreground">
        {text} בעלי העסק יכולים להוסיף הרשאה במסך הצוות.
      </p>
      <Link
        to="/manage"
        className="mt-1 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
      >
        ללוח הבקרה
      </Link>
    </div>
  );
}

/** שלד טעינה של כרטיס — שומר על הגובה (בלי קפיצה כשהנתונים מגיעים) */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-2xl bg-[var(--hm-line-soft)]", className)}
    />
  );
}
