// מסך "יחידות ומתחמים" (/manage/units): בלי מקום אירוח — מצב ריק והקמה ראשונה;
// אחרת רשימה מקובצת לפי מתחם, עם הוספה ועריכה מהירה, קישור לעמוד של כל יחידה ומתחם,
// סידור היחידות, יחידות לא פעילות בנפרד, ומתחמים בארכיון (לבעלים). כל שינוי דרך פונקציות
// השרת (מיגרציה 10).
import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  BedDouble,
  ChevronDown,
  ChevronLeft,
  MapPin,
  Pencil,
  Plus,
  Settings2,
} from "lucide-react";
import {
  Button,
  buttonVariants,
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
import { PROPERTY_TYPE_LABELS, UNIT_TYPE_LABELS } from "./labels";
import {
  activeUnits,
  archivedCount,
  inactiveUnits,
  missingForBooking,
  newUnitDefaults,
  physicalUnits,
  unitSummary,
  unitsLimit,
  visibleProperties,
  wholeUnit,
  type UnitForm,
} from "./model";
import { StatusPill } from "./parts";
import { UnitCard } from "./UnitCard";
import { UnitOrder } from "./UnitOrder";
import { useUnitExtras, type UnitExtras } from "./useUnitExtras";

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
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">יחידות ומתחמים</h1>
        <p className="mt-1 text-muted-foreground">המקומות שאתם משכירים — כל מתחם והיחידות שבו.</p>
        <p className="mt-1 text-sm">
          <Link to="/manage/room-types" className="font-medium text-primary hover:underline">
            סוגי חדרים
          </Link>
          <span className="text-muted-foreground"> — למלונות: כמה חדרים זהים שנמכרים כסוג אחד</span>
        </p>
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

/** מתחמים בארכיון: לבעלים — רשימה שנפתחת (קישור לעמוד המתחם להחזרה או מחיקה); למנהל — רק מספר */
function ArchivedNote({ view }: { view: CatalogView }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const archived = view.properties.filter((p) => p.status === "archived");
  const n = archivedCount(view);
  if (n === 0) return null;
  if (!view.can_owner)
    return (
      <p className="text-sm text-muted-foreground">
        {count(n, "מתחם אחד בארכיון", "מתחמים בארכיון")} — לא מוצג כאן.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        className="min-h-11 w-fit gap-2"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className={open ? "size-4 rotate-180" : "size-4"} aria-hidden="true" />
        {count(n, "מתחם אחד בארכיון", "מתחמים בארכיון")}
      </Button>
      {open && (
        <ul id={listId} className="divide-y rounded-md border">
          {archived.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 p-3" data-archived={p.name}>
              <Link
                to="/manage/properties/$propertyId"
                params={{ propertyId: p.id }}
                className="min-w-0 flex-1 font-medium text-primary hover:underline"
              >
                {p.name}
              </Link>
              <StatusPill tone="muted">בארכיון</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogList({ view }: { view: CatalogView }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const extras = useUnitExtras();
  const properties = visibleProperties(view);
  const limit = unitsLimit(view.limits);
  const close = () => setSheet(null);
  const addUnit = (p: CatalogProperty | null) =>
    setSheet({
      kind: "unit-new",
      propertyId: p?.id ?? (properties.length === 1 ? properties[0]!.id : null),
      defaults: newUnitDefaults(p ?? properties[0]),
    });
  // ?add=unit — "הוספת יחידה" מלוח הבקרה: פותח את הטופס פעם אחת (אם החבילה מאפשרת) ומנקה את
  // הכתובת; אם לא — ההסבר כבר מוצג בראש המסך
  const add = (useSearch({ strict: false }) as { add?: string }).add;
  const navigate = useNavigate();
  useEffect(() => {
    if (add !== "unit") return;
    if (limit.canAdd) addUnit(null);
    void navigate({ to: "/manage/units", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- פעם אחת, כשהכתובת מבקשת
  }, [add]);

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
          amenities={view.amenities}
          extras={extras}
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
  amenities: CatalogView["amenities"];
  extras: UnitExtras;
  canAdd: boolean;
  onEdit: () => void;
  onAddUnit: () => void;
  onEditUnit: (u: CatalogUnit) => void;
}) {
  const p = props.property;
  const Icon = PROPERTY_ICONS[p.property_type];
  const units = physicalUnits(p);
  const active = activeUnits(p);
  const inactive = inactiveUnits(p);
  const whole = wholeUnit(p);
  const [ordering, setOrdering] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const inactiveId = useId();
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
            <h2 className="break-words">
              <Link
                to="/manage/properties/$propertyId"
                params={{ propertyId: p.id }}
                className="hover:underline"
              >
                {p.name}
              </Link>
            </h2>
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
        <div className="flex flex-wrap gap-2">
          <Link
            to="/manage/properties/$propertyId"
            params={{ propertyId: p.id }}
            className={buttonVariants({ variant: "outline", className: "min-h-11 gap-2" })}
          >
            <Settings2 className="size-4" aria-hidden="true" />
            ניהול המתחם<span className="sr-only"> {p.name}</span>
          </Link>
          <Button variant="outline" className="min-h-11 gap-2" onClick={props.onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            עריכה<span className="sr-only"> של המתחם {p.name}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {ordering ? (
          <UnitOrder property={p} onDone={() => setOrdering(false)} />
        ) : units.length === 0 && !whole ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-[var(--hm-surface-2)] px-6 py-8 text-center">
            <span
              aria-hidden="true"
              className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-700)]"
            >
              <BedDouble className="size-6" strokeWidth={1.7} />
            </span>
            <p className="font-semibold">אין עדיין יחידות במתחם הזה.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              מוסיפים יחידה — שם, כמה אורחים, מיטות — ואחר כך מחיר ותמונות, והיא מוכנה להזמנות.
            </p>
          </div>
        ) : (
          (active.length > 0 || whole) && (
            <ul
              aria-label={`היחידות ב${p.name}`}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {active.map((u) => (
                <UnitCard
                  key={u.id}
                  unit={u}
                  property={p}
                  amenities={props.amenities}
                  extras={props.extras}
                  onEdit={() => props.onEditUnit(u)}
                />
              ))}
              {whole && <WholeRow unit={whole} onEdit={() => props.onEditUnit(whole)} />}
            </ul>
          )
        )}
        {!ordering && inactive.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              className="min-h-11 w-fit gap-2"
              aria-expanded={showInactive}
              aria-controls={inactiveId}
              onClick={() => setShowInactive((o) => !o)}
            >
              <ChevronDown
                className={showInactive ? "size-4 rotate-180" : "size-4"}
                aria-hidden="true"
              />
              יחידות לא פעילות ({inactive.length})
            </Button>
            {showInactive && (
              <ul
                id={inactiveId}
                aria-label={`יחידות לא פעילות ב${p.name}`}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {inactive.map((u) => (
                  <UnitCard
                    key={u.id}
                    unit={u}
                    property={p}
                    amenities={props.amenities}
                    extras={props.extras}
                    onEdit={() => props.onEditUnit(u)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
        {!ordering && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              className="min-h-11 w-fit gap-2"
              disabled={!props.canAdd}
              onClick={props.onAddUnit}
            >
              <Plus className="size-4" aria-hidden="true" />
              הוספת יחידה<span className="sr-only"> ל{p.name}</span>
            </Button>
            {active.length >= 2 && (
              <Button
                variant="ghost"
                className="min-h-11 w-fit gap-2"
                onClick={() => setOrdering(true)}
              >
                <ArrowUpDown className="size-4" aria-hidden="true" />
                סידור היחידות<span className="sr-only"> ב{p.name}</span>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WholeRow({ unit: u, onEdit }: { unit: CatalogUnit; onEdit: () => void }) {
  const members = u.member_ids?.length ?? 0;
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-2xl border bg-[var(--hm-surface-2)] p-4 sm:col-span-2 lg:col-span-3"
      data-unit={u.name}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <Link
            to="/manage/units/$unitId"
            params={{ unitId: u.id }}
            className="inline-flex items-center gap-1 break-words hover:underline"
          >
            {u.name}
            <ChevronLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
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
