// שלב E3: תכונה שלא כלולה בחבילה של האתר — הסבר במקום כפתור שייכשל
import { Gem } from "lucide-react";

export function PremiumNotice({ feature }: { feature: string }) {
  return (
    <div
      role="note"
      data-premium-notice
      className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm"
    >
      <Gem className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-medium">{feature} — זמין בחבילת פרימיום</p>
        <p className="mt-1 text-muted-foreground">
          לשדרוג החבילה פנו אלינו. מה שכבר קיים ממשיך לעבוד כרגיל.
        </p>
      </div>
    </div>
  );
}
