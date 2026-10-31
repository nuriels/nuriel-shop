// מסך "יחידות ומתחמים" (/manage/units): בלי מקום אירוח — מצב ריק והקמה ראשונה;
// אחרת רשימה מקובצת לפי מתחם, עם הוספה ועריכה. כל שינוי דרך פונקציות השרת (מיגרציה 10).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Pencil, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from "@/platform/ui";
import { hospitalityCatalog } from "../../api/catalog.functions";
import type { CatalogProperty, CatalogUnit, CatalogView } from "../../types/catalog";
import { manageKeys } from "../lib/query-keys";
import { PropertySheet, UnitSheet } from "./CatalogSheets";
import { FirstRun } from "./FirstRun";
import { PROPERTY_ICONS, UNIT_ICONS } from "./icons";
import { BUSINESS_TYPES, PROPERTY_TYPE_LABELS, UNIT_TYPE_LABELS, setupUnitType } from "./labels";
import {
  archivedCount,
  missingForBooking,
  nextUnitName,
  physicalUnits,
  unitSummary,
  unitsLimit,
  visibleProperties,
  wholeUnit,
  type UnitForm,
} from "./model";

type SheetState =
  | { kind: "property-new" }
  | { kind: "property-edit"; property: CatalogProperty }
  | { kind: "unit-new"; propertyId: string | null; defaults: Partial<UnitForm> }
  | { kind: "unit-edit"; unit: CatalogUnit };

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export function CatalogPage() {
  const catalog = useQuery({
    queryKey: manageKeys.catalog,
    queryFn: () => hospitalityCatalog(),
    refetchOnWindowFocus: false,
  });
  const view = catalog.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">יחידות ומתחמים</h1>
        <p className="mt-1 text-muted-foreground">המקומות שאתם משכירים — כל מתחם והיחידות שבו.</p>
      </div>
      {catalog.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {catalog.error instanceof Error ? catalog.error.message : "טעינת היחידות נכשלה"}
        </p>
      ) : !view ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
          <span className="sr-only">טוען את היחידות…</span>
        </div>
      ) : visibleProperties(view).length === 0 ? (
        <>
          <FirstRun view={view} />
          <ArchivedNote view={view} />
        </>
      ) : (
        <CatalogList view={view} />
      )}
    </div>
  );
}

function ArchivedNote({ view }: { view: CatalogView }) {
  const n = archivedCount(view);
  if (n === 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {count(n, "מתחם אחד בארכיון", "מתחמים בארכיון")} — לא מוצג כאן.
    </p>
  );
}

function newUnitDefaults(p: CatalogProperty | undefined): Partial<UnitForm> {
  if (!p) return {};
  const word = BUSINESS_TYPES[p.property_type].unitWord;
  return {
    unit_type: setupUnitType(p.property_type),
    name: nextUnitName(
      word,
      p.units.map((u) => u.name),
    ),
  };
}

function CatalogList({ view }: { view: CatalogView }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const properties = visibleProperties(view);
  const limit = unitsLimit(view.limits);
  const close = () => setSheet(null);
  const addUnit = (p: CatalogProperty | null) =>
    setSheet({
      kind: "unit-new",
      propertyId: p?.id ?? (properties.length === 1 ? properties[0]!.id : null),
      defaults: newUnitDefaults(p ?? properties[0]),
    });

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="font-medium" data-testid="units-limit">
            {limit.text}
          </p>
          {view.limits.max_units !== null && (
            <Progress
              value={Math.min(
                100,
                Math.round((view.limits.units_used / view.limits.max_units) * 100),
              )}
              aria-label="יחידות פעילות מתוך החבילה"
            />
          )}
          {limit.reason && (
            <p role="status" className="text-sm text-muted-foreground">
              {limit.reason}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="min-h-11 gap-2"
              disabled={!limit.canAdd}
              onClick={() => addUnit(null)}
            >
              <Plus className="size-4" aria-hidden="true" />
              הוספת יחידה
            </Button>
            <Button
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => setSheet({ kind: "property-new" })}
            >
              <Plus className="size-4" aria-hidden="true" />
              הוספת מתחם
            </Button>
          </div>
        </CardContent>
      </Card>

      {properties.map((p) => (
        <PropertyCard
          key={p.id}
          property={p}
          canAdd={limit.canAdd}
          onEdit={() => setSheet({ kind: "property-edit", property: p })}
          onAddUnit={() => addUnit(p)}
          onEditUnit={(unit) => setSheet({ kind: "unit-edit", unit })}
        />
      ))}

      <ArchivedNote view={view} />

      {sheet?.kind === "property-new" && <PropertySheet open property={null} onClose={close} />}
      {sheet?.kind === "property-edit" && (
        <PropertySheet key={sheet.property.id} open property={sheet.property} onClose={close} />
      )}
      {sheet?.kind === "unit-new" && (
        <UnitSheet
          open
          view={view}
          unit={null}
          propertyId={sheet.propertyId}
          defaults={sheet.defaults}
          onClose={close}
        />
      )}
      {sheet?.kind === "unit-edit" && (
        <UnitSheet
          key={sheet.unit.id}
          open
          view={view}
          unit={sheet.unit}
          propertyId={null}
          onClose={close}
        />
      )}
    </>
  );
}

function PropertyCard(props: {
  property: CatalogProperty;
  canAdd: boolean;
  onEdit: () => void;
  onAddUnit: () => void;
  onEditUnit: (u: CatalogUnit) => void;
}) {
  const p = props.property;
  const Icon = PROPERTY_ICONS[p.property_type];
  const units = physicalUnits(p);
  const whole = wholeUnit(p);
  return (
    <Card data-property={p.name}>
      <CardHeader className="flex flex-row flex-wrap items-start gap-3 space-y-0">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-lg">
            <h2 className="break-words">{p.name}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {PROPERTY_TYPE_LABELS[p.property_type]} · {count(units.length, "יחידה אחת", "יחידות")}
          </p>
          {p.address && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">{p.address}</span>
            </p>
          )}
          {p.status === "draft" && (
            <span className="mt-1.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              טיוטה — לא יוצג לאורחים
            </span>
          )}
        </div>
        <Button variant="outline" className="min-h-11 gap-2" onClick={props.onEdit}>
          <Pencil className="size-4" aria-hidden="true" />
          עריכה<span className="sr-only"> של המתחם {p.name}</span>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {units.length === 0 && !whole ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            אין עדיין יחידות במתחם הזה.
          </p>
        ) : (
          <ul aria-label={`היחידות ב${p.name}`} className="divide-y rounded-md border">
            {units.map((u) => (
              <UnitRow key={u.id} unit={u} onEdit={() => props.onEditUnit(u)} />
            ))}
            {whole && <WholeRow unit={whole} onEdit={() => props.onEditUnit(whole)} />}
          </ul>
        )}
        <Button
          variant="ghost"
          className="min-h-11 w-fit gap-2"
          disabled={!props.canAdd}
          onClick={props.onAddUnit}
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת יחידה<span className="sr-only"> ל{p.name}</span>
        </Button>
      </CardContent>
    </Card>
  );
}

function UnitRow({ unit: u, onEdit }: { unit: CatalogUnit; onEdit: () => void }) {
  const Icon = UNIT_ICONS[u.unit_type];
  const missing = missingForBooking(u);
  return (
    <li className="flex flex-wrap items-center gap-3 p-3" data-unit={u.name}>
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-words">{u.name}</span>
          {!u.is_active && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              לא פעילה
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {UNIT_TYPE_LABELS[u.unit_type]} · {unitSummary(u)}
        </p>
        {missing.length > 0 && (
          <p className="text-xs text-amber-800">עוד חסר כדי לקבל הזמנות: {missing.join(" ו")}</p>
        )}
      </div>
      <Button variant="outline" className="min-h-11 min-w-11 gap-2 px-3 sm:px-4" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">עריכה</span>
        <span className="sr-only"> של {u.name}</span>
      </Button>
    </li>
  );
}

function WholeRow({ unit: u, onEdit }: { unit: CatalogUnit; onEdit: () => void }) {
  const members = u.member_ids?.length ?? 0;
  return (
    <li className="flex flex-wrap items-center gap-3 bg-muted/30 p-3" data-unit={u.name}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-words">{u.name}</span>
          {!u.is_active && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              לא פעיל
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          השכרת המתחם כולו · הזמנה אחת ל-{members} יחידות · {unitSummary(u)}
        </p>
      </div>
      <Button variant="outline" className="min-h-11 min-w-11 gap-2 px-3 sm:px-4" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">עריכה</span>
        <span className="sr-only"> של {u.name}</span>
      </Button>
    </li>
  );
}
