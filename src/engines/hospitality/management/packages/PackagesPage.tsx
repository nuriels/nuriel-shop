// שלב א' 7: "חבילות" — חבילות אירוח וחבילות מיוחדות (למשל "חבילת כלה – שני לילות ב-VIP").
// חבילה = יחידה אחת, מספר לילות קבוע ומחיר קבוע לכל החבילה, עד כמה אורחים, תיאור, תנאים, תמונות
// (מהגלריות שכבר קיימות — בלי להעלות שוב), תקופה ומדיניות ביטול. ההזמנה נרשמת על היחידה — אותה
// תפוסה, כך שאי אפשר להזמין את היחידה פעמיים לאותם לילות. הכול נבדק שוב במסד (מיגרציה 59).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  Switch,
  Textarea,
  cn,
} from "@/platform/ui";
import { hospitalityGallery } from "../../api/media.functions";
import {
  hospitalityPackageDelete,
  hospitalityPackageSave,
  hospitalityPackageSetActive,
  hospitalityPackages,
} from "../../api/packages.functions";
import type { MediaItem } from "../../types/media";
import type { PackageKind, PackagesView, StaffPackage } from "../../types/packages";
import { PACKAGE_MAX_MEDIA, PACKAGE_MAX_NIGHTS, PACKAGE_TEXT_MAX } from "../../validation/packages";
import { FormSheet } from "../catalog/CatalogSheets";
import { errorText } from "../catalog/refresh";
import { formatDate, formatMoney } from "../lib/format";
import { manageKeys } from "../lib/query-keys";

const PACKAGES_KEY = [...manageKeys.all, "packages"] as const;
const KIND_LABEL: Record<PackageKind, string> = {
  package: "חבילת אירוח",
  special: "חבילה מיוחדת",
};
const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

export function PackagesPage() {
  const qc = useQueryClient();
  const view = useQuery({ queryKey: PACKAGES_KEY, queryFn: () => hospitalityPackages() });
  const [editing, setEditing] = useState<StaffPackage | "new" | null>(null);
  const [deleting, setDeleting] = useState<StaffPackage | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PACKAGES_KEY });
    void qc.invalidateQueries({ queryKey: manageKeys.activity });
  };
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => hospitalityPackageSetActive({ data: v }),
    onSuccess: (p) => {
      toast.success(p.is_active ? `"${p.name}" מוצגת באתר` : `"${p.name}" הוסתרה מהאתר`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => hospitalityPackageDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("החבילה נמחקה");
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      toast.error(errorText(e));
      setDeleting(null);
    },
  });
  const data = view.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">חבילות</h1>
          <p className="mt-1 text-muted-foreground">
            חבילת אירוח או חבילה מיוחדת (למשל "חבילת כלה – שני לילות ב-VIP"): יחידה אחת, מספר לילות
            קבוע ומחיר לכל החבילה. ההזמנה נרשמת על היחידה, כך שאי אפשר להזמין אותה פעמיים לאותם
            לילות.
          </p>
        </div>
        <Button
          className="min-h-11 gap-2"
          onClick={() => setEditing("new")}
          disabled={!data || data.units.length === 0}
        >
          <Plus className="size-4" aria-hidden="true" />
          חבילה חדשה
        </Button>
      </div>

      {view.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {errorText(view.error)}
        </p>
      ) : !data ? (
        <Skeleton className="h-56 w-full" />
      ) : data.units.length === 0 ? (
        <p className="text-muted-foreground">קודם מוסיפים יחידה ב"יחידות" — חבילה תמיד על יחידה.</p>
      ) : data.packages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Gift className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">עוד אין חבילות</p>
            <p className="max-w-md text-sm text-muted-foreground">
              חבילה חדשה נשמרת מוסתרת. כשהיא מוכנה — מסמנים "מוצגת באתר", והיא מופיעה בעמוד הבית
              ובעמוד משלה, עם הזמנה ישירה.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="packages-list">
          {data.packages.map((p) => (
            <li key={p.id}>
              <PackageRow
                pkg={p}
                busy={toggle.isPending}
                onToggle={(active) => toggle.mutate({ id: p.id, active })}
                onEdit={() => setEditing(p)}
                onDelete={() => setDeleting(p)}
              />
            </li>
          ))}
        </ul>
      )}

      {data && editing && (
        <PackageSheet
          key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
          view={data}
          pkg={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p, created) => {
            toast.success(
              created ? `"${p.name}" נשמרה — מוסתרת עד שמסמנים "מוצגת באתר"` : "החבילה נשמרה",
            );
            setEditing(null);
            refresh();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              אפשר למחוק רק חבילה שעוד לא הוזמנה. חבילה שהוזמנה — מסתירים מהאתר; ההזמנות שומרות את
              פרטי החבילה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting.id);
              }}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PackageRow({
  pkg,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  pkg: StaffPackage;
  busy: boolean;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const switchId = `pkg-active-${pkg.id}`;
  const period =
    pkg.stay_from || pkg.stay_to
      ? `לשהייה ${pkg.stay_from ? `מ-${formatDate(pkg.stay_from)}` : ""}${pkg.stay_from && pkg.stay_to ? " " : ""}${pkg.stay_to ? `עד ${formatDate(pkg.stay_to)}` : ""}`
      : null;
  return (
    <Card data-package-row={pkg.name}>
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{pkg.name}</h2>
            <Badge variant={pkg.kind === "special" ? "default" : "secondary"} className="gap-1">
              {pkg.kind === "special" && <Sparkles className="size-3" aria-hidden="true" />}
              {KIND_LABEL[pkg.kind]}
            </Badge>
            {!pkg.is_active && <Badge variant="outline">מוסתרת</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[
              pkg.unit_name,
              pkg.nights === 1 ? "לילה אחד" : `${pkg.nights} לילות`,
              `עד ${pkg.max_guests} אורחים`,
              formatMoney(Number(pkg.price)),
              period,
              pkg.bookings_count > 0 ? `${pkg.bookings_count} הזמנות` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={pkg.is_active}
              disabled={busy}
              onCheckedChange={(v) => onToggle(v)}
            />
            <Label htmlFor={switchId} className="text-sm">
              מוצגת באתר
            </Label>
          </div>
          <Button variant="outline" className="min-h-11 gap-1.5" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            עריכה
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 gap-1.5 text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label={`מחיקת ${pkg.name}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface Form {
  kind: PackageKind;
  name: string;
  unitId: string;
  nights: string;
  price: string;
  maxGuests: string;
  stayFrom: string;
  stayTo: string;
  description: string;
  terms: string;
  policyId: string;
  mediaIds: string[];
}

function initialForm(view: PackagesView, pkg: StaffPackage | null): Form {
  const unit = view.units.find((u) => u.is_active) ?? view.units[0];
  return pkg
    ? {
        kind: pkg.kind,
        name: pkg.name,
        unitId: pkg.unit_id,
        nights: String(pkg.nights),
        price: String(Number(pkg.price)),
        maxGuests: String(pkg.max_guests),
        stayFrom: pkg.stay_from ?? "",
        stayTo: pkg.stay_to ?? "",
        description: pkg.description ?? "",
        terms: pkg.terms ?? "",
        policyId: pkg.policy_id ?? "",
        mediaIds: pkg.media_ids,
      }
    : {
        kind: "special",
        name: "",
        unitId: unit?.id ?? "",
        nights: "2",
        price: "",
        maxGuests: String(Math.min(2, unit?.capacity ?? 2)),
        stayFrom: "",
        stayTo: "",
        description: "",
        terms: "",
        policyId: "",
        mediaIds: [],
      };
}

function validate(f: Form, capacity: number): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  const nights = Number(f.nights);
  const price = Number(f.price);
  const guests = Number(f.maxGuests);
  if (f.name.trim().length < 2 || f.name.trim().length > 80)
    e.name = "שם החבילה — בין 2 ל-80 תווים";
  if (!f.unitId) e.unitId = "בוחרים יחידה";
  if (!Number.isInteger(nights) || nights < 1 || nights > PACKAGE_MAX_NIGHTS)
    e.nights = `בין 1 ל-${PACKAGE_MAX_NIGHTS} לילות`;
  if (!f.price || !Number.isFinite(price) || price <= 0 || Math.round(price * 100) !== price * 100)
    e.price = "מחיר לכל החבילה, בשקלים";
  if (!Number.isInteger(guests) || guests < 1 || guests > capacity)
    e.maxGuests = `בין 1 ל-${capacity} (התפוסה של היחידה)`;
  if (f.stayFrom && f.stayTo) {
    const days = (Date.parse(f.stayTo) - Date.parse(f.stayFrom)) / 86_400_000;
    if (!(days >= nights)) e.stayTo = "התקופה קצרה ממספר הלילות בחבילה";
  }
  if (f.description.length > PACKAGE_TEXT_MAX) e.description = "עד 4000 תווים";
  if (f.terms.length > PACKAGE_TEXT_MAX) e.terms = "עד 4000 תווים";
  return e;
}

function PackageSheet({
  view,
  pkg,
  onClose,
  onSaved,
}: {
  view: PackagesView;
  pkg: StaffPackage | null;
  onClose: () => void;
  onSaved: (p: StaffPackage, created: boolean) => void;
}) {
  const start = useMemo(() => initialForm(view, pkg), [view, pkg]);
  const [form, setForm] = useState<Form>(start);
  const [submitted, setSubmitted] = useState(false);
  const unit = view.units.find((u) => u.id === form.unitId);
  const capacity = unit?.capacity ?? 50;
  const errors = validate(form, capacity);
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      hospitalityPackageSave({
        data: {
          id: pkg?.id ?? null,
          unitId: form.unitId,
          kind: form.kind,
          name: form.name.trim(),
          nights: Number(form.nights),
          price: Number(form.price),
          maxGuests: Number(form.maxGuests),
          description: form.description,
          terms: form.terms,
          stayFrom: form.stayFrom || null,
          stayTo: form.stayTo || null,
          policyId: form.policyId || null,
          mediaIds: form.mediaIds,
          expectedRevision: pkg?.revision ?? null,
        },
      }),
    onSuccess: (p) => onSaved(p, !pkg),
  });
  const err = (k: keyof Form) => (submitted ? errors[k] : undefined);
  const field = (id: string, label: string, k: keyof Form, input: ReactNode, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {err(k) ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {err(k)}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );

  return (
    <FormSheet
      open
      title={pkg ? `עריכת "${pkg.name}"` : "חבילה חדשה"}
      description="המחיר — לכל החבילה (כל הלילות). ההזמנה נבדקת מול היומן של היחידה."
      dirty={dirty}
      busy={save.isPending}
      submitLabel={pkg ? "שמירת החבילה" : "יצירת החבילה"}
      serverError={save.isError ? errorText(save.error) : null}
      notice={
        pkg && pkg.bookings_count > 0
          ? "לחבילה כבר יש הזמנות — הן נשארות בפרטים ובמחיר שהאורחים הזמינו. השינוי חל על הזמנות חדשות."
          : null
      }
      hasErrors={Object.keys(errors).length > 0}
      submitted={submitted}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(errors).length === 0) save.mutate();
      }}
      onClose={onClose}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">סוג הפריט</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["package", "special"] as const).map((k) => (
            <label
              key={k}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                form.kind === k ? "border-primary bg-primary/5" : "border-input",
              )}
            >
              <input
                type="radio"
                name="pkg-kind"
                value={k}
                checked={form.kind === k}
                onChange={() => set("kind", k)}
                className="size-4 accent-[var(--primary)]"
              />
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      {field(
        "pkg-name",
        "שם החבילה",
        "name",
        <Input
          id="pkg-name"
          value={form.name}
          maxLength={80}
          onChange={(e) => set("name", e.target.value)}
          aria-invalid={!!err("name")}
          placeholder="חבילת כלה – שני לילות ב-VIP"
        />,
      )}
      {field(
        "pkg-unit",
        "היחידה",
        "unitId",
        <select
          id="pkg-unit"
          className={SELECT}
          value={form.unitId}
          onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value, mediaIds: [] }))}
        >
          {view.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {view.units.some((x) => x.property_id !== u.property_id)
                ? ` — ${u.property_name}`
                : ""}
              {u.is_active ? "" : " (מוסתרת)"}
            </option>
          ))}
        </select>,
        "החבילה תופסת את היחידה הזו בלילות ההזמנה",
      )}
      <div className="grid grid-cols-3 gap-3">
        {field(
          "pkg-nights",
          "לילות",
          "nights",
          <Input
            id="pkg-nights"
            type="number"
            inputMode="numeric"
            min={1}
            max={PACKAGE_MAX_NIGHTS}
            value={form.nights}
            onChange={(e) => set("nights", e.target.value)}
            aria-invalid={!!err("nights")}
          />,
        )}
        {field(
          "pkg-price",
          "מחיר החבילה (₪)",
          "price",
          <Input
            id="pkg-price"
            type="number"
            inputMode="decimal"
            min={1}
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            aria-invalid={!!err("price")}
          />,
        )}
        {field(
          "pkg-guests",
          "עד כמה אורחים",
          "maxGuests",
          <Input
            id="pkg-guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={capacity}
            value={form.maxGuests}
            onChange={(e) => set("maxGuests", e.target.value)}
            aria-invalid={!!err("maxGuests")}
          />,
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field(
          "pkg-from",
          "זמינה מתאריך (לא חובה)",
          "stayFrom",
          <Input
            id="pkg-from"
            type="date"
            value={form.stayFrom}
            onChange={(e) => set("stayFrom", e.target.value)}
          />,
        )}
        {field(
          "pkg-to",
          "עד תאריך (לא חובה)",
          "stayTo",
          <Input
            id="pkg-to"
            type="date"
            value={form.stayTo}
            onChange={(e) => set("stayTo", e.target.value)}
            aria-invalid={!!err("stayTo")}
          />,
          "העזיבה עד התאריך הזה",
        )}
      </div>
      {field(
        "pkg-description",
        "תיאור",
        "description",
        <Textarea
          id="pkg-description"
          rows={4}
          maxLength={PACKAGE_TEXT_MAX}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="מה מחכה לאורחים: עיצוב החדר, בקבוק יין, ארוחת בוקר…"
        />,
      )}
      {field(
        "pkg-terms",
        "תנאי החבילה",
        "terms",
        <Textarea
          id="pkg-terms"
          rows={3}
          maxLength={PACKAGE_TEXT_MAX}
          value={form.terms}
          onChange={(e) => set("terms", e.target.value)}
          placeholder="מה כלול ומה לא, הגבלות…"
        />,
        "האורח מאשר את התנאים לפני שליחת הבקשה",
      )}
      {field(
        "pkg-policy",
        "מדיניות ביטול",
        "policyId",
        <select
          id="pkg-policy"
          className={SELECT}
          value={form.policyId}
          onChange={(e) => set("policyId", e.target.value)}
        >
          <option value="">כמו ביחידה</option>
          {view.policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.is_default ? " (ברירת המחדל)" : ""}
            </option>
          ))}
        </select>,
      )}
      {unit && (
        <ImagePicker
          unitId={unit.id}
          propertyId={unit.property_id}
          value={form.mediaIds}
          onChange={(ids) => set("mediaIds", ids)}
        />
      )}
    </FormSheet>
  );
}

/** בחירת תמונות מהגלריה של היחידה ושל המתחם — בלי להעלות עותקים */
function ImagePicker({
  unitId,
  propertyId,
  value,
  onChange,
}: {
  unitId: string;
  propertyId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const unitGallery = useQuery({
    queryKey: [...manageKeys.all, "gallery", "unit", unitId],
    queryFn: () => hospitalityGallery({ data: { ownerKind: "unit", ownerId: unitId } }),
    retry: false,
  });
  const propertyGallery = useQuery({
    queryKey: [...manageKeys.all, "gallery", "property", propertyId],
    queryFn: () => hospitalityGallery({ data: { ownerKind: "property", ownerId: propertyId } }),
    retry: false,
  });
  const images: MediaItem[] = [
    ...(unitGallery.data?.items ?? []),
    ...(propertyGallery.data?.items ?? []),
  ].filter((m) => m.kind === "image" && m.thumb_url);
  const toggle = (id: string) =>
    onChange(
      value.includes(id)
        ? value.filter((x) => x !== id)
        : value.length < PACKAGE_MAX_MEDIA
          ? [...value, id]
          : value,
    );
  return (
    <fieldset className="flex flex-col gap-2" data-testid="package-images">
      <legend className="mb-1 text-sm font-medium">תמונות</legend>
      <p className="text-xs text-muted-foreground">
        מהגלריה של היחידה ושל המתחם (בלי להעלות שוב). הראשונה שנבחרה — התמונה הראשית. עד{" "}
        {PACKAGE_MAX_MEDIA}. בלי בחירה — התמונה של היחידה.
      </p>
      {unitGallery.isPending || propertyGallery.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : unitGallery.isError && propertyGallery.isError ? (
        <p className="text-sm text-muted-foreground">אין גישה לתמונות — אפשר לשמור בלי לבחור.</p>
      ) : images.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          אין עדיין תמונות ליחידה — מוסיפים ב"תמונות", ואז בוחרים כאן.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((m) => {
            const at = value.indexOf(m.id);
            const picked = at >= 0;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={picked}
                  aria-label={`${picked ? "הסרת" : "בחירת"} ${m.alt || "תמונה"}`}
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden rounded-md border-2",
                    picked ? "border-primary" : "border-transparent",
                  )}
                >
                  <img src={m.thumb_url ?? ""} alt="" className="h-full w-full object-cover" />
                  {picked && (
                    <span className="absolute top-1 end-1 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                      {at === 0 ? <Check className="size-3.5" aria-hidden="true" /> : at + 1}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
