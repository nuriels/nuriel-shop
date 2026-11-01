// מתקנים (Stage 2d): סימון מתקנים מהקטלוג של העסק, לפי קבוצות, עם הערה קצרה לכל מתקן;
// הוספה מהרשימה המוכנה בלחיצה, ומתקן משלכם (שם, קבוצה, אייקון) — נוסף לקטלוג ומסומן מיד.
// הסימון נשמר עם העמוד (שמירה אחת); הקטלוג עצמו נשמר מיד דרך פונקציות המסד.
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, cn } from "@/platform/ui";
import {
  hospitalityAddPresetAmenity,
  hospitalityCreateAmenity,
  hospitalityDeleteAmenity,
  hospitalityUpdateAmenity,
} from "../../api/details.functions";
import {
  AMENITY_CATEGORIES,
  type Amenity,
  type AmenityCategory,
  type AmenityLink,
  type CatalogView,
} from "../../types/catalog";
import {
  AMENITY_ICONS,
  NOTE_MAX,
  amenityError,
  type AmenityIcon as IconName,
} from "../../validation/details";
import { SelectField, TextField } from "../lib/fields";
import { FormSheet } from "../catalog/CatalogSheets";
import { ConfirmButton } from "../catalog/parts";
import { errorText, useRefresh } from "../catalog/refresh";
import { AmenityIcon } from "./AmenityIcon";
import { AMENITY_CATEGORY_LABELS } from "./labels";

const categoryOf = (a: Amenity): AmenityCategory =>
  (AMENITY_CATEGORIES as readonly string[]).includes(a.category ?? "")
    ? (a.category as AmenityCategory)
    : "other";

export function AmenityPicker(props: {
  view: CatalogView;
  value: AmenityLink[];
  onChange: (v: AmenityLink[]) => void;
  /** "unit" — מתקנים ביחידה (פרטיים); "property" — במתחם (משותפים) */
  scope: "unit" | "property";
  readOnly: boolean;
  error?: string | undefined;
}) {
  const refresh = useRefresh();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Amenity | "new" | null>(null);
  const selected = new Map(props.value.map((l) => [l.amenity_id, l]));
  const inCatalog = new Set(props.view.amenities.map((a) => a.preset_code).filter(Boolean));
  const presets = props.view.amenity_presets.filter((p) => !inCatalog.has(p.code));
  const groups = AMENITY_CATEGORIES.map((c) => ({
    category: c,
    items: props.view.amenities.filter((a) => categoryOf(a) === c),
  })).filter((g) => g.items.length > 0);

  const toggle = (id: string, on: boolean) =>
    props.onChange(
      on
        ? [...props.value, { amenity_id: id, note: null }]
        : props.value.filter((l) => l.amenity_id !== id),
    );
  const setNote = (id: string, note: string) =>
    props.onChange(props.value.map((l) => (l.amenity_id === id ? { ...l, note } : l)));
  const pick = (id: string) => {
    if (!selected.has(id)) props.onChange([...props.value, { amenity_id: id, note: null }]);
  };

  const addPreset = async (code: string, name: string) => {
    setBusyCode(code);
    try {
      const { id } = await hospitalityAddPresetAmenity({ data: { code } });
      pick(id);
      toast.success(`"${name}" נוסף ונבחר — לא לשכוח לשמור`);
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusyCode(null);
    }
  };

  const where = props.scope === "unit" ? "ביחידה" : "במתחם";
  return (
    <div className="flex flex-col gap-4" data-testid={`amenities-${props.scope}`}>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          עוד אין מתקנים ברשימה של העסק. מוסיפים מהרשימה המוכנה למטה, או מתקן משלכם.
        </p>
      )}
      {groups.map((g) => (
        <fieldset key={g.category} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">
            {AMENITY_CATEGORY_LABELS[g.category]}
          </legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.items.map((a) => {
              const link = selected.get(a.id);
              const id = `amenity-${props.scope}-${a.id}`;
              return (
                <li
                  key={a.id}
                  data-amenity={a.name}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border p-2",
                    link && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex min-h-11 items-center gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={Boolean(link)}
                      disabled={props.readOnly}
                      onChange={(e) => toggle(a.id, e.target.checked)}
                    />
                    <Label htmlFor={id} className="flex flex-1 cursor-pointer items-center gap-2">
                      <AmenityIcon name={a.icon} />
                      {a.name}
                    </Label>
                    {!a.preset_code && !props.readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 min-w-11"
                        aria-label={`עריכת המתקן ${a.name}`}
                        onClick={() => setSheet(a)}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {link && (
                    <Input
                      aria-label={`הערה ל${a.name} (לא חובה)`}
                      placeholder="הערה (לא חובה) — למשל מחומם, בתוספת תשלום"
                      maxLength={NOTE_MAX}
                      value={link.note ?? ""}
                      disabled={props.readOnly}
                      onChange={(e) => setNote(a.id, e.target.value)}
                      className="min-h-11"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      {props.error && <p className="text-sm text-destructive">{props.error}</p>}

      {!props.readOnly && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          {presets.length > 0 && (
            <>
              <p className="text-sm font-medium">הוספה מהרשימה</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <Button
                    key={p.code}
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-2"
                    disabled={busyCode !== null}
                    aria-label={`הוספת ${p.name} ${where}`}
                    onClick={() => void addPreset(p.code, p.name)}
                  >
                    <AmenityIcon name={p.icon} />
                    {p.name}
                  </Button>
                ))}
              </div>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-fit gap-2"
            onClick={() => setSheet("new")}
          >
            <Plus className="size-4" aria-hidden="true" />
            מתקן משלכם
          </Button>
        </div>
      )}

      {sheet && (
        <AmenitySheet
          amenity={sheet === "new" ? null : sheet}
          onClose={() => setSheet(null)}
          onCreated={(id) => {
            pick(id);
            refresh();
          }}
          onRemoved={(id) => {
            props.onChange(props.value.filter((l) => l.amenity_id !== id));
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** מתקן משלכם: הוספה או עריכה (שם, קבוצה, אייקון), והסרה מהקטלוג */
function AmenitySheet(props: {
  amenity: Amenity | null;
  onClose: () => void;
  onCreated: (id: string) => void;
  onRemoved: (id: string) => void;
}) {
  const a = props.amenity;
  const initial = {
    name: a?.name ?? "",
    category: a ? categoryOf(a) : ("other" as AmenityCategory),
    icon: ((AMENITY_ICONS as readonly string[]).includes(a?.icon ?? "")
      ? a!.icon
      : "check") as IconName,
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const error = amenityError(form.name, form.category, form.icon);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    setBusy(true);
    setServerError(null);
    try {
      if (a) {
        await hospitalityUpdateAmenity({ data: { id: a.id, ...form, name: form.name.trim() } });
        toast.success("המתקן עודכן");
        props.onCreated(a.id);
      } else {
        const { id } = await hospitalityCreateAmenity({
          data: { ...form, name: form.name.trim() },
        });
        toast.success(`"${form.name.trim()}" נוסף ונבחר — לא לשכוח לשמור`);
        props.onCreated(id);
      }
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!a) return;
    try {
      const r = await hospitalityDeleteAmenity({ data: { id: a.id } });
      const used = r.units + r.properties;
      toast.success(used > 0 ? `המתקן הוסר מהרשימה ומ-${used} מקומות` : "המתקן הוסר מהרשימה");
      props.onRemoved(a.id);
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  return (
    <FormSheet
      open
      title={a ? `עריכת ${a.name}` : "מתקן משלכם"}
      description="שם קצר, קבוצה ואייקון. המתקן נוסף לרשימה של העסק — ואפשר לסמן אותו בכל יחידה."
      dirty={dirty}
      busy={busy}
      submitLabel={a ? "שמירה" : "הוספה"}
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      <TextField
        idPrefix="amenity"
        name="name"
        label="שם המתקן"
        required
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        error={submitted && error?.includes("שם") ? error : undefined}
        placeholder="למשל סאונה, שולחן פינג-פונג"
      />
      <SelectField
        idPrefix="amenity"
        name="category"
        label="קבוצה"
        value={form.category}
        options={AMENITY_CATEGORIES.map((c) => ({ value: c, label: AMENITY_CATEGORY_LABELS[c] }))}
        onChange={(v) => setForm((f) => ({ ...f, category: v }))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">אייקון</legend>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-7">
          {AMENITY_ICONS.map((icon) => (
            <label
              key={icon}
              className={cn(
                "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                form.icon === icon && "border-primary bg-primary/10",
              )}
            >
              <input
                type="radio"
                name="amenity-icon"
                className="sr-only"
                value={icon}
                checked={form.icon === icon}
                onChange={() => setForm((f) => ({ ...f, icon }))}
                aria-label={`אייקון ${icon}`}
              />
              <AmenityIcon name={icon} className="size-5" />
            </label>
          ))}
        </div>
      </fieldset>
      {a && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            הסרה מהרשימה מורידה את המתקן מכל היחידות והמתחמים שבהם סומן.
          </p>
          <ConfirmButton
            label="הסרה מהרשימה"
            destructive
            icon={<Trash2 className="size-4" aria-hidden="true" />}
            title={`להסיר את ${a.name}?`}
            description={<p>המתקן יוסר מהרשימה של העסק ומכל מקום שבו סומן.</p>}
            confirmLabel="הסרה"
            onConfirm={remove}
          />
        </div>
      )}
    </FormSheet>
  );
}
