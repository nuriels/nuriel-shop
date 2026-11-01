// מקום לתמונה כשעדיין אין (בלי תמונות מוגנות): רקע חם עם קו מתאר עדין של נוף ובית.
import { cn } from "@/platform/ui";

export function Placeholder({
  label,
  className,
  tone = "light",
}: {
  label?: string;
  className?: string;
  tone?: "light" | "dark" | undefined;
}) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden",
        dark
          ? "bg-[radial-gradient(120%_90%_at_70%_20%,oklch(0.36_0.03_70),var(--site-deep))]"
          : "bg-[linear-gradient(160deg,var(--site-sand),oklch(0.9_0.02_78))]",
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        viewBox="0 0 240 120"
        className={cn(
          "w-2/3 max-w-[22rem]",
          dark ? "text-white/25" : "text-[var(--site-gold-ink)]/40",
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
      >
        <path d="M0 98 C40 70 70 62 100 78 S170 60 240 84" />
        <path d="M0 110 C50 92 90 90 130 100 S200 92 240 102" />
        <path d="M150 74 V52 L168 38 L186 52 V74" />
        <path d="M163 74 V62 H173 V74" />
        <circle cx="58" cy="30" r="10" />
      </svg>
      {label && (
        <span
          className={cn(
            "absolute bottom-3 start-3 text-xs tracking-wide",
            dark ? "text-white/60" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
