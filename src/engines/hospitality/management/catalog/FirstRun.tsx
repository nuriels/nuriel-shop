// מצב ריק + ההקמה הראשונה: "מה אתם משכירים?" → שם המקום והיחידות הראשונות.
// הכל נשמר דרך פונקציית השרת (property_create + unit_create במסד). המחירים, התמונות
// והמיטות — בשלבים הבאים; שום דבר לא מוצג לאורחים עד שהאתר יעלה.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Info, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from "@/platform/ui";
import { hospitalitySetupPlace } from "../../api/catalog.functions";
import type { CatalogView, PropertyType } from "../../types/catalog";
import { MAX_SETUP_UNITS, propertyFieldError, unitFieldError } from "../../validation/catalog";
import { NumberField, TextField } from "../lib/fields";
import { manageKeys } from "../lib/query-keys";
import { PROPERTY_ICONS } from "./icons";
import { BUSINESS_TYPES, FIRST_RUN_TYPES } from "./labels";
import { nextUnitName, setupRows, unitsLimit, type SetupRow } from "./model";

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "ההקמה נכשלה — נסו שוב";

export function FirstRun({ view }: { view: CatalogView }) {
  const [chosen, setChosen] = useState<PropertyType | null>(null);
  const [step, setStep] = useState<"choose" | "details">("choose");
  const limit = unitsLimit(view.limits);

  if (step === "details" && chosen) {
    return (
      <SetupForm
        type={chosen}
        maxUnits={Math.min(MAX_SETUP_UNITS, limit.remaining ?? MAX_SETUP_UNITS)}
        onBack={() => setStep("choose")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            <h2>בואו נקים את מקום האירוח שלכם</h2>
          </CardTitle>
          <CardDescription className="text-base">
            עוד לא הוספתם מקום אירוח. זה לוקח דקה — ואפשר לשנות הכל אחר כך.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="שלבי ההקמה">
            {[
              "בוחרים מה אתם משכירים",
              "נותנים שם ומספר אורחים",
              "מוסיפים תמונות ומחיר — במסך היחידה",
            ].map((text, i) => (
              <li key={text} className="flex items-center gap-2 rounded-md bg-background p-3">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {!limit.canAdd && (
        <p role="status" className="rounded-md border p-3 text-sm text-destructive">
          {limit.reason}
        </p>
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) setStep("details");
        }}
      >
        <fieldset>
          <legend className="mb-3 text-lg font-semibold">מה אתם משכירים?</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIRST_RUN_TYPES.map((type) => {
              const info = BUSINESS_TYPES[type];
              const Icon = PROPERTY_ICONS[type];
              const selected = chosen === type;
              return (
                <label
                  key={type}
                  data-business-type={type}
                  className={cn(
                    "flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border bg-card p-4 transition-colors",
                    "hover:border-primary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    selected && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  <input
                    type="radio"
                    name="business-type"
                    value={type}
                    checked={selected}
                    onChange={() => setChosen(type)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-full",
                      selected ? "bg-primary text-primary-foreground" : "bg-secondary",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{info.label}</span>
                    <span className="text-sm text-muted-foreground">{info.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button
          type="submit"
          className="min-h-11 w-full sm:w-fit sm:min-w-40"
          disabled={!chosen || !limit.canAdd}
        >
          המשך
        </Button>
      </form>
    </div>
  );
}

function SetupForm({
  type,
  maxUnits,
  onBack,
}: {
  type: PropertyType;
  maxUnits: number;
  onBack: () => void;
}) {
  const info = BUSINESS_TYPES[type];
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [bedrooms, setBedrooms] = useState("1");
  const [rows, setRows] = useState<SetupRow[]>(() =>
    setupRows(type).slice(0, Math.max(1, maxUnits)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
  const nameError = submitted ? propertyFieldError("name", name.trim()) : null;
  const capacityError =
    submitted && info.single ? unitFieldError("capacity", toInt(capacity)) : null;
  const bedroomsError =
    submitted && info.single ? unitFieldError("bedrooms", toInt(bedrooms)) : null;
  const rowErrors = rows.map((r) =>
    submitted
      ? {
          name: unitFieldError("name", r.name.trim()),
          capacity: unitFieldError("capacity", toInt(r.capacity)),
        }
      : { name: null, capacity: null },
  );
  const hasErrors =
    propertyFieldError("name", name.trim()) !== null ||
    (info.single
      ? unitFieldError("capacity", toInt(capacity)) !== null ||
        unitFieldError("bedrooms", toInt(bedrooms)) !== null
      : rows.some(
          (r) =>
            unitFieldError("name", r.name.trim()) !== null ||
            unitFieldError("capacity", toInt(r.capacity)) !== null,
        ));

  const setRow = (i: number, patch: Partial<SetupRow>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    setBusy(true);
    setServerError(null);
    try {
      const units = info.single
        ? [{ name: name.trim(), capacity: toInt(capacity), bedrooms: toInt(bedrooms) }]
        : rows.map((r) => ({ name: r.name.trim(), capacity: toInt(r.capacity), bedrooms: 1 }));
      const result = await hospitalitySetupPlace({
        data: { propertyType: type, name: name.trim(), units },
      });
      if (result.message) {
        toast.warning(
          `נוספו ${result.created} מתוך ${result.requested} יחידות. ${result.message}`,
          { duration: 8000 },
        );
      } else {
        toast.success("מקום האירוח נוצר");
      }
      void queryClient.invalidateQueries({ queryKey: manageKeys.catalog });
      void queryClient.invalidateQueries({ queryKey: manageKeys.context });
      void queryClient.invalidateQueries({ queryKey: manageKeys.activity });
    } catch (err) {
      setServerError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5"
      aria-labelledby="setup-title"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" className="min-h-11 gap-2" onClick={onBack}>
          <ArrowRight className="size-4" aria-hidden="true" />
          חזרה לבחירה
        </Button>
        <h2 id="setup-title" className="text-xl font-semibold">
          {info.label}
        </h2>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <TextField
            idPrefix="setup"
            name="name"
            label={info.nameLabel}
            placeholder={info.namePlaceholder}
            required
            value={name}
            onChange={setName}
            error={nameError ?? undefined}
          />
          {info.single && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                idPrefix="setup"
                name="capacity"
                label="כמה אורחים לכל היותר"
                min={1}
                max={100}
                value={capacity}
                onChange={setCapacity}
                error={capacityError ?? undefined}
                hint="כולל ילדים"
              />
              <NumberField
                idPrefix="setup"
                name="bedrooms"
                label="חדרי שינה"
                min={0}
                max={50}
                value={bedrooms}
                onChange={setBedrooms}
                error={bedroomsError ?? undefined}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {!info.single && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <h3>היחידות שלכם</h3>
            </CardTitle>
            <CardDescription>
              מתחילים עם מה שיש — אפשר להוסיף, לשנות שם ולהשלים פרטים בהמשך.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3" aria-label="היחידות שיתווספו">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start"
                >
                  <div className="flex-1">
                    <TextField
                      idPrefix={`setup-unit-${i}`}
                      name="name"
                      label={`שם ה${info.unitWord} (${i + 1})`}
                      value={row.name}
                      onChange={(v) => setRow(i, { name: v })}
                      error={rowErrors[i]?.name ?? undefined}
                    />
                  </div>
                  <NumberField
                    idPrefix={`setup-unit-${i}`}
                    name="capacity"
                    label="אורחים לכל היותר"
                    min={1}
                    max={100}
                    value={row.capacity}
                    onChange={(v) => setRow(i, { capacity: v })}
                    error={rowErrors[i]?.capacity ?? undefined}
                  />
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 gap-2 self-end text-muted-foreground"
                      onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span className="sm:sr-only">הסרה</span>
                      <span className="sr-only"> של {row.name || `${info.unitWord} ${i + 1}`}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              className="mt-3 min-h-11 gap-2"
              disabled={rows.length >= maxUnits}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    name: nextUnitName(
                      info.unitWord,
                      list.map((r) => r.name),
                    ),
                    capacity: "2",
                  },
                ])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              הוספת {info.unitWord}
            </Button>
            {rows.length >= maxUnits && (
              <p className="mt-2 text-xs text-muted-foreground">
                זה המקסימום להקמה הראשונה בחבילה שלכם — אפשר להוסיף עוד בהמשך לפי החבילה.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          אחרי ההקמה תוכלו להוסיף תיאור, מיטות, תמונות ומחירים. שום דבר לא מוצג לאורחים עד שהאתר
          שלכם יעלה.
        </p>
      </div>

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}
      {submitted && hasErrors && (
        <p role="status" className="text-sm text-destructive">
          יש שדות לתיקון.
        </p>
      )}

      <Button type="submit" className="min-h-11 w-full gap-2 sm:w-fit sm:min-w-48" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        יצירת מקום האירוח
      </Button>
    </form>
  );
}
