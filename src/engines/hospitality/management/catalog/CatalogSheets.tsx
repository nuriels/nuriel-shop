// חלוניות ההוספה והעריכה של מתחם ושל יחידה (מלמטה בטלפון, מהצד במחשב). השמירה דרך
// פונקציות השרת בלבד; "עודכן בינתיים" — מיזוג בלי לדרוס את השינוי של המשתמש האחר.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from "@/platform/ui";
import {
  hospitalityCreateProperty,
  hospitalityCreateUnit,
  hospitalityUpdateProperty,
  hospitalityUpdateUnit,
} from "../../api/catalog.functions";
import {
  PROPERTY_TYPES,
  UNIT_TYPES,
  type CatalogProperty,
  type CatalogUnit,
  type CatalogView,
} from "../../types/catalog";
import { PROPERTY_LABELS, UNIT_LABELS } from "../../validation/catalog";
import { ChoiceField, NumberField, SelectField, TextAreaField, TextField } from "../lib/fields";
import { manageKeys } from "../lib/query-keys";
import { useRefresh } from "./refresh";
import { PROPERTY_TYPE_LABELS, UNIT_TYPE_LABELS } from "./labels";
import {
  PROPERTY_FORM_KEYS,
  UNIT_FORM_KEYS,
  findProperty,
  findUnit,
  mergeAfterConflict,
  propertyChanges,
  propertyFields,
  propertyFormErrors,
  propertyFormFrom,
  unitChanges,
  unitFields,
  unitFormErrors,
  unitFormFrom,
  type PropertyForm,
  type UnitForm,
} from "./model";

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "השמירה נכשלה — נסו שוב";

/** המעטפת המשותפת: חלונית, הודעות, שמירה, ושאלה לפני סגירה עם שינויים */
function FormSheet(props: {
  open: boolean;
  title: string;
  description: string;
  dirty: boolean;
  busy: boolean;
  submitLabel: string;
  serverError: string | null;
  notice: ReactNode | null;
  hasErrors: boolean;
  submitted: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [confirmClose, setConfirmClose] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.notice || props.serverError) noticeRef.current?.focus();
  }, [props.notice, props.serverError]);

  return (
    <>
      <Sheet
        open={props.open}
        onOpenChange={(open) => {
          if (open) return;
          if (props.dirty && !props.busy) setConfirmClose(true);
          else props.onClose();
        }}
      >
        <SheetContent
          side={isMobile ? "bottom" : "left"}
          className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader className="ps-10 text-start sm:text-start">
            <SheetTitle>{props.title}</SheetTitle>
            <SheetDescription>{props.description}</SheetDescription>
          </SheetHeader>
          <form
            noValidate
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!props.busy) props.onSubmit();
            }}
          >
            {(props.notice || props.serverError) && (
              <div
                ref={noticeRef}
                tabIndex={-1}
                role={props.serverError ? "alert" : "status"}
                className={
                  props.serverError
                    ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                    : "flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
                }
              >
                {props.serverError ?? (
                  <>
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div className="flex flex-col gap-1">{props.notice}</div>
                  </>
                )}
              </div>
            )}
            {props.children}
            {props.submitted && props.hasErrors && (
              <p role="status" className="text-sm text-destructive">
                יש שדות לתיקון.
              </p>
            )}
            <div className="sticky bottom-0 -mx-6 flex gap-2 border-t bg-background px-6 py-3">
              <Button
                type="submit"
                className="min-h-11 flex-1 gap-2 sm:flex-none"
                disabled={props.busy}
              >
                {props.busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {props.submitLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={props.busy}
                onClick={() => (props.dirty ? setConfirmClose(true) : props.onClose())}
              >
                ביטול
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>לצאת בלי לשמור?</AlertDialogTitle>
            <AlertDialogDescription>
              יש שינויים שעוד לא נשמרו. אם תצאו, הם יימחקו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">להמשיך לערוך</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                setConfirmClose(false);
                props.onClose();
              }}
            >
              לצאת בלי לשמור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ConflictNotice({
  title,
  changed,
  dropped,
}: {
  title: string;
  changed: string[];
  dropped: string[];
}) {
  return (
    <>
      <p className="font-medium">{title} הטופס עודכן לערכים העדכניים.</p>
      {changed.length > 0 && <p>שונו בינתיים: {changed.join(", ")}.</p>}
      {dropped.length > 0 && (
        <p>
          השינוי שלך ב{dropped.join(", ")} לא נשמר, כי גם המשתמש האחר שינה אותו — בדקו ושנו שוב.
        </p>
      )}
      <p>שאר השינויים שלך עדיין בטופס — לחצו "שמירה" כדי לשמור אותם.</p>
    </>
  );
}

// ---------------------------------------------------------------- מתחם

export function PropertySheet(props: {
  open: boolean;
  /** null = מתחם חדש */
  property: CatalogProperty | null;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const editing = props.property !== null;
  const [revision, setRevision] = useState(props.property?.revision ?? 1);
  const [base, setBase] = useState<PropertyForm>(() => propertyFormFrom(props.property));
  const [form, setForm] = useState<PropertyForm>(base);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ changed: string[]; dropped: string[] } | null>(null);

  const errors = propertyFormErrors(form);
  const hasErrors = Object.keys(errors).length > 0;
  const changes = propertyChanges(base, form);
  const dirty = editing ? Object.keys(changes).length > 0 : form.name.trim() !== "";
  const err = (k: keyof PropertyForm) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof PropertyForm>(k: K, v: PropertyForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    if (editing && !dirty) return props.onClose();
    setBusy(true);
    setServerError(null);
    try {
      if (!editing) {
        await hospitalityCreateProperty({ data: { data: propertyFields(form) } });
        toast.success("המתחם נוסף");
        refresh();
        props.onClose();
        return;
      }
      const result = await hospitalityUpdateProperty({
        data: { id: props.property!.id, changes, revision },
      });
      if (result.status === "saved") {
        toast.success("המתחם נשמר");
        refresh();
        props.onClose();
        return;
      }
      const latest = findProperty(result.view, props.property!.id);
      queryClient.setQueryData<CatalogView>(manageKeys.catalog, result.view);
      if (!latest || latest.status === "archived") {
        setServerError("המתחם הועבר לארכיון או נמחק בינתיים.");
        return;
      }
      const latestForm = propertyFormFrom(latest);
      const merged = mergeAfterConflict(PROPERTY_FORM_KEYS, base, form, latestForm);
      setBase(latestForm);
      setForm(merged.form);
      setRevision(latest.revision);
      setNotice({
        changed: merged.remoteChanged.map((k) => PROPERTY_LABELS[k]),
        dropped: merged.dropped.map((k) => PROPERTY_LABELS[k]),
      });
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      open={props.open}
      title={editing ? `עריכת המתחם ${props.property!.name}` : "מתחם חדש"}
      description={
        editing
          ? 'השינויים נשמרים רק אחרי "שמירה".'
          : "מקום נוסף שאתם משכירים — עם כתובת ויחידות משלו."
      }
      dirty={dirty}
      busy={busy}
      submitLabel={editing ? "שמירה" : "הוספת המתחם"}
      serverError={serverError}
      notice={
        notice && (
          <ConflictNotice
            title="המתחם עודכן בינתיים על ידי משתמש אחר."
            changed={notice.changed}
            dropped={notice.dropped}
          />
        )
      }
      hasErrors={hasErrors}
      submitted={submitted}
      onSubmit={() => void save()}
      onClose={props.onClose}
    >
      <TextField
        idPrefix="property"
        name="name"
        label={PROPERTY_LABELS.name}
        required
        value={form.name}
        onChange={(v) => set("name", v)}
        error={err("name")}
      />
      <SelectField
        idPrefix="property"
        name="property_type"
        label={PROPERTY_LABELS.property_type}
        value={form.property_type}
        options={PROPERTY_TYPES.map((t) => ({ value: t, label: PROPERTY_TYPE_LABELS[t] }))}
        onChange={(v) => set("property_type", v)}
        error={err("property_type")}
      />
      <TextField
        idPrefix="property"
        name="address"
        label={PROPERTY_LABELS.address}
        value={form.address}
        onChange={(v) => set("address", v)}
        error={err("address")}
        autoComplete="street-address"
        hint="לא חובה. תוצג לאורחים אחרי שההזמנה תאושר."
      />
      <TextAreaField
        idPrefix="property"
        name="description"
        label={PROPERTY_LABELS.description}
        value={form.description}
        onChange={(v) => set("description", v)}
        error={err("description")}
        hint="כמה משפטים על המקום, הנוף והאווירה."
      />
      <ChoiceField
        name="property-status"
        label={PROPERTY_LABELS.status}
        value={form.status}
        onChange={(v) => set("status", v)}
        options={[
          { value: "active", label: "פעיל", hint: "יוצג לאורחים כשהאתר שלכם יעלה" },
          { value: "draft", label: "טיוטה", hint: "עוד לא מוכן — לא יוצג לאורחים" },
        ]}
      />
    </FormSheet>
  );
}

// ---------------------------------------------------------------- יחידה

export function UnitSheet(props: {
  open: boolean;
  view: CatalogView;
  /** null = יחידה חדשה */
  unit: CatalogUnit | null;
  /** יחידה חדשה: המתחם שנבחר מראש */
  propertyId: string | null;
  /** יחידה חדשה: ברירות המחדל (שם פנוי, סוג לפי המתחם) */
  defaults?: Partial<UnitForm>;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const editing = props.unit !== null;
  const properties = props.view.properties.filter((p) => p.status !== "archived");
  const [propertyId, setPropertyId] = useState(
    props.unit?.property_id ?? props.propertyId ?? properties[0]?.id ?? "",
  );
  const [revision, setRevision] = useState(props.unit?.revision ?? 1);
  const [base, setBase] = useState<UnitForm>(() => unitFormFrom(props.unit, props.defaults));
  const [form, setForm] = useState<UnitForm>(base);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ changed: string[]; dropped: string[] } | null>(null);

  const errors = unitFormErrors(form);
  const hasErrors = Object.keys(errors).length > 0;
  const changes = unitChanges(base, form);
  const dirty = Object.keys(changes).length > 0;
  const err = (k: keyof UnitForm) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof UnitForm>(k: K, v: UnitForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const whole = props.unit?.kind === "whole_property";

  const save = async () => {
    setSubmitted(true);
    if (hasErrors) return;
    if (editing && !dirty) return props.onClose();
    setBusy(true);
    setServerError(null);
    try {
      if (!editing) {
        await hospitalityCreateUnit({ data: { propertyId, data: unitFields(form) } });
        toast.success(`נוספה יחידה: ${form.name.trim()}`);
        refresh();
        props.onClose();
        return;
      }
      const result = await hospitalityUpdateUnit({
        data: { id: props.unit!.id, changes, revision },
      });
      if (result.status === "saved") {
        toast.success("היחידה נשמרה");
        refresh();
        props.onClose();
        return;
      }
      const latest = findUnit(result.view, props.unit!.id);
      queryClient.setQueryData<CatalogView>(manageKeys.catalog, result.view);
      if (!latest) {
        setServerError("היחידה נמחקה בינתיים.");
        return;
      }
      const latestForm = unitFormFrom(latest);
      const merged = mergeAfterConflict(UNIT_FORM_KEYS, base, form, latestForm);
      setBase(latestForm);
      setForm(merged.form);
      setRevision(latest.revision);
      setNotice({
        changed: merged.remoteChanged.map((k) => UNIT_LABELS[k]),
        dropped: merged.dropped.map((k) => UNIT_LABELS[k]),
      });
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      open={props.open}
      title={editing ? `עריכת ${props.unit!.name}` : "יחידה חדשה"}
      description={
        whole
          ? '"כל המתחם" — הזמנה אחת לכל היחידות שבו.'
          : "הפרטים הבסיסיים. מחירים, מיטות ותמונות — בשלבים הבאים."
      }
      dirty={dirty}
      busy={busy}
      submitLabel={editing ? "שמירה" : "הוספת היחידה"}
      serverError={serverError}
      notice={
        notice && (
          <ConflictNotice
            title="היחידה עודכנה בינתיים על ידי משתמש אחר."
            changed={notice.changed}
            dropped={notice.dropped}
          />
        )
      }
      hasErrors={hasErrors}
      submitted={submitted}
      onSubmit={() => void save()}
      onClose={props.onClose}
    >
      {!editing && properties.length > 1 && (
        <SelectField
          idPrefix="unit"
          name="property"
          label="מתחם"
          value={propertyId}
          options={properties.map((p) => ({ value: p.id, label: p.name }))}
          onChange={setPropertyId}
        />
      )}
      <TextField
        idPrefix="unit"
        name="name"
        label={UNIT_LABELS.name}
        required
        value={form.name}
        onChange={(v) => set("name", v)}
        error={err("name")}
      />
      {!whole && (
        <SelectField
          idPrefix="unit"
          name="unit_type"
          label={UNIT_LABELS.unit_type}
          value={form.unit_type}
          options={UNIT_TYPES.map((t) => ({ value: t, label: UNIT_TYPE_LABELS[t] }))}
          onChange={(v) => set("unit_type", v)}
          error={err("unit_type")}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          idPrefix="unit"
          name="capacity"
          label={UNIT_LABELS.capacity}
          min={1}
          max={100}
          value={form.capacity}
          onChange={(v) => set("capacity", v)}
          error={err("capacity")}
          hint="כולל ילדים"
        />
        <NumberField
          idPrefix="unit"
          name="base_occupancy"
          label="כמה אורחים כלולים במחיר"
          min={1}
          max={100}
          value={form.base_occupancy}
          onChange={(v) => set("base_occupancy", v)}
          error={err("base_occupancy")}
          hint="מעבר לזה — תוספת לכל אורח (המחירים בשלב הבא)"
        />
        <NumberField
          idPrefix="unit"
          name="bedrooms"
          label={UNIT_LABELS.bedrooms}
          min={0}
          max={50}
          value={form.bedrooms}
          onChange={(v) => set("bedrooms", v)}
          error={err("bedrooms")}
        />
        <NumberField
          idPrefix="unit"
          name="bathrooms"
          label={UNIT_LABELS.bathrooms}
          min={0}
          max={50}
          value={form.bathrooms}
          onChange={(v) => set("bathrooms", v)}
          error={err("bathrooms")}
        />
        <NumberField
          idPrefix="unit"
          name="child_age_limit"
          label={UNIT_LABELS.child_age_limit}
          min={0}
          max={17}
          value={form.child_age_limit}
          onChange={(v) => set("child_age_limit", v)}
          error={err("child_age_limit")}
          hint="עד הגיל הזה האורח נחשב ילד במחיר"
        />
      </div>
      <TextAreaField
        idPrefix="unit"
        name="description"
        label={UNIT_LABELS.description}
        value={form.description}
        onChange={(v) => set("description", v)}
        error={err("description")}
        hint="מה מיוחד ביחידה — נוף, ג׳קוזי, פרטיות."
      />
    </FormSheet>
  );
}
