// כרטיס יחידה במסך "יחידות ומתחמים": תמונה ראשית, שם, סוג, אורחים ומיטות, מחיר ללילה (ובסוף
// השבוע), מתקנים, הלילה (פנוי / תפוס), מצב הפרסום באתר, עריכה מהירה וצפייה באתר.
import { Link } from "@tanstack/react-router";
import { ExternalLink, Pencil } from "lucide-react";
import { Button, cn } from "@/platform/ui";
import type { Amenity, CatalogProperty, CatalogUnit } from "../../types/catalog";
import { unitPath } from "../../website/lib/format";
import { formatMoney } from "../lib/format";
import { UNIT_ICONS } from "./icons";
import { UNIT_TYPE_LABELS } from "./labels";
import { unitSummary } from "./model";
import { amenityPreview, bedsText, publishState, type PublishState } from "./unit-cards";
import type { UnitExtras } from "./useUnitExtras";

const PUBLISH_CLASS: Record<PublishState, string> = {
  live: "bg-[var(--hm-success-bg)] text-[var(--hm-success)]",
  closed: "bg-[var(--hm-info-bg)] text-[var(--hm-info)]",
  missing: "bg-[var(--hm-warning-bg)] text-[var(--hm-warning)]",
  draft: "bg-[var(--hm-warning-bg)] text-[var(--hm-warning)]",
  inactive: "bg-[var(--hm-neutral-bg)] text-[var(--hm-neutral)]",
};

export function UnitCard({
  unit: u,
  property,
  amenities,
  extras,
  onEdit,
}: {
  unit: CatalogUnit;
  property: CatalogProperty;
  amenities: readonly Amenity[];
  extras: UnitExtras;
  onEdit: () => void;
}) {
  const Icon = UNIT_ICONS[u.unit_type];
  const cover = extras.cover.get(u.id);
  const price = extras.price.get(u.id);
  const slug = extras.slug.get(u.id);
  const tonight = u.is_active ? extras.tonight.get(u.id) : undefined;
  const pub = publishState(u, property, extras.siteOpen);
  const am = amenityPreview(u, amenities);
  const beds = bedsText(u.beds);
  const nameId = `unit-card-name-${u.id}`;
  return (
    <li
      data-unit={u.name}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--hm-shadow-card)]",
        !u.is_active && "opacity-95",
      )}
    >
      <div className="relative aspect-[16/10] bg-[var(--hm-surface-2)]">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Icon className="size-8" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-xs">אין עדיין תמונה</span>
          </div>
        )}
        <span
          className={cn(
            "absolute top-2 start-2 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm",
            PUBLISH_CLASS[pub.state],
          )}
        >
          {pub.label}
        </span>
        {tonight && (
          <span
            className={cn(
              "absolute top-2 end-2 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm",
              tonight === "free"
                ? "bg-card text-[var(--hm-success)]"
                : "bg-[var(--hm-lagoon-900)] text-white",
            )}
          >
            {tonight === "free" ? "פנוי הלילה" : tonight === "booked" ? "תפוס הלילה" : "חסום הלילה"}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 id={nameId} className="font-semibold break-words">
          <Link to="/manage/units/$unitId" params={{ unitId: u.id }} className="hover:underline">
            {u.name}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {UNIT_TYPE_LABELS[u.unit_type]} · {unitSummary(u)}
        </p>
        {beds && <p className="text-sm">מיטות: {beds}</p>}
        {price ? (
          <p className="text-sm">
            <span className="font-semibold">{formatMoney(price.base, extras.currency)}</span>{" "}
            <span className="text-muted-foreground">ללילה</span>
            {price.weekend !== null && price.weekend !== price.base && (
              <span className="text-muted-foreground">
                {" "}
                · סוף שבוע {formatMoney(price.weekend, extras.currency)}
              </span>
            )}
          </p>
        ) : (
          !u.has_price && <p className="text-sm text-[var(--hm-warning)]">עוד אין מחיר ללילה</p>
        )}
        {am.shown.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={`מתקנים ב${u.name}`}>
            {am.shown.map((n, i) => (
              <li
                key={`${i}-${n}`}
                className="rounded-full bg-[var(--hm-lagoon-50)] px-2 py-0.5 text-xs"
              >
                {n}
              </li>
            ))}
            {am.more > 0 && (
              <li className="rounded-full px-1 py-0.5 text-xs text-muted-foreground">
                ועוד {am.more}
              </li>
            )}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button variant="outline" className="min-h-11 gap-2 px-4" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            עריכה<span className="sr-only"> של {u.name}</span>
          </Button>
          {slug && pub.state === "live" && (
            <a
              href={unitPath(slug)}
              target="_blank"
              rel="noopener"
              aria-describedby={nameId}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-[var(--hm-lagoon-500)] hover:bg-[var(--hm-lagoon-50)]"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              צפייה באתר
              <span className="sr-only">(נפתח בחלון חדש)</span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
