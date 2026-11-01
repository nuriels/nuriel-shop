// כותרת של חלק באתר: שורת-על קטנה בזהב, כותרת בגופן התצוגה, תת-כותרת.
import { cn } from "@/platform/ui";

export function SectionHeading({
  id,
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  id?: string | undefined;
  eyebrow?: string | undefined;
  title: string;
  subtitle?: string | undefined;
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}
    >
      {eyebrow && (
        <p className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold-ink)]">
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className="font-display text-3xl leading-tight font-medium text-foreground sm:text-4xl"
      >
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{subtitle}</p>
      )}
      <span
        aria-hidden="true"
        className={cn(
          "mt-6 block h-px w-14 bg-[var(--site-gold)]",
          align === "center" && "mx-auto",
        )}
      />
    </div>
  );
}
