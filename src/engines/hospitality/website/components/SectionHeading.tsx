// כותרת של חלק באתר: שורת-על קטנה בזהב, כותרת בגופן התצוגה, תת-כותרת.
// F5: data-section-heading / data-eyebrow / data-heading-rule — החתימה של כל ערכה (theme/signature.ts).
import { cn } from "@/platform/ui";
import { useSite } from "../lib/site-context";
import { Editable } from "./Editable";

export function SectionHeading({
  id,
  eyebrow,
  title,
  subtitle,
  align: alignProp,
  className,
  section,
}: {
  id?: string | undefined;
  /** D2: מזהה המקטע — הטקסטים ניתנים לעריכה ישירה בתצוגה המקדימה */
  section?: string | undefined;
  eyebrow?: string | undefined;
  title: string;
  subtitle?: string | undefined;
  /** ברירת המחדל — לפי הערכה */
  align?: "center" | "start" | undefined;
  className?: string;
}) {
  const { theme } = useSite();
  const align = alignProp ?? theme.layout.headingAlign;
  return (
    <div
      data-section-heading=""
      className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}
    >
      {eyebrow && (
        <p
          data-eyebrow=""
          className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold-ink)]"
        >
          <Editable section={section} field="eyebrow" value={eyebrow} />
        </p>
      )}
      <h2
        id={id}
        className="font-display text-3xl leading-tight font-medium text-foreground sm:text-4xl"
      >
        <Editable section={section} field="title" value={title} />
      </h2>
      {subtitle && (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          <Editable section={section} field="subtitle" value={subtitle} />
        </p>
      )}
      <span
        aria-hidden="true"
        data-heading-rule=""
        className={cn(
          "mt-6 block h-px w-14 bg-[var(--site-gold)]",
          align === "center" && "mx-auto",
        )}
      />
    </div>
  );
}
