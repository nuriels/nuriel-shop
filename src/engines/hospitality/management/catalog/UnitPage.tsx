// עמוד היחידה (/manage/units/$unitId) — Stage 2c.3: כל הפרטים בכרטיסים (פרטים, אורחים,
// חדרים), מצב היחידה (הפעלה / השבתה) ומחיקה לצמיתות (בעלים בלבד). Stage 2d: מקסימום
// מבוגרים / ילדים, שירותים נפרדים, מיטות לפי חדר ומתקנים ביחידה — באותה שמירה. שמירה עם הגרסה
// שנטענה; "עודכן בינתיים" — מיזוג בלי לדרוס את השינוי של המשתמש האחר. כל פעולה נבדקת
// שוב במסד (הרשאה, מגבלת החבילה, "כל המתחם", הזמנות).
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Power, PowerOff, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/platform/ui";
import {
  hospitalityCatalog,
  hospitalityDeleteUnit,
  hospitalitySetUnitActive,
  hospitalityUpdateUnit,
} from "../../api/catalog.functions";
import {
  UNIT_TYPES,
  type CatalogProperty,
  type CatalogUnit,
  type CatalogView,
} from "../../types/catalog";
import { UNIT_LABELS } from "../../validation/catalog";
import { NumberField, SelectField, TextAreaField, TextField } from "../lib/fields";
import { AmenityPicker } from "../details/AmenityPicker";
import { BedsEditor } from "../details/BedsEditor";
import { MediaGallery } from "../media/MediaGallery";
import { useManagement } from "../shell/management-context";
import { manageKeys } from "../lib/query-keys";
import { ConflictNotice } from "./CatalogSheets";
import { PROPERTY_TYPE_LABELS, UNIT_TYPE_LABELS } from "./labels";
import {
  ARCHIVED_FOR_MANAGER,
  GONE_UNIT,
  UNIT_FORM_KEYS,
  UNIT_FORM_LABELS,
  activateBlock,
  deactivateBlock,
  findProperty,
  findUnit,
  mergeAfterConflict,
  missingForBooking,
  physicalUnits,
  unitChanges,
  unitDeleteBlock,
  unitFormErrors,
  unitFormFrom,
  type UnitForm,
} from "./model";
import {
  BackLink,
  ConfirmButton,
  LeaveGuard,
  LoadError,
  NotFound,
  PageNotice,
  PageSkeleton,
  SaveBar,
  StatusPill,
} from "./parts";
import { errorText, useRefresh } from "./refresh";

export function UnitPage() {
  const params = useParams({ strict: false }) as { unitId?: string };
  const catalog = useQuery({
    queryKey: manageKeys.catalog,
    queryFn: () => hospitalityCatalog(),
    refetchOnWindowFocus: false,
  });
  if (catalog.isError) return <LoadError error={catalog.error} />;
  if (!catalog.data) return <PageSkeleton label="טוען את היחידה…" />;
  const view = catalog.data;
  const unit = params.unitId ? findUnit(view, params.unitId) : null;
  const property = unit ? findProperty(view, unit.property_id) : null;
  if (!unit || !property) return <NotFound what="היחידה" />;
  return <UnitEditor key={unit.id} view={view} unit={unit} property={property} />;
}

interface Notice {
  changed: string[];
  dropped: string[];
  /** פעולה (הפעלה / מחיקה) שלא בוצעה כי הנתונים השתנו */
  skipped: boolean;
}

function UnitEditor({
  view,
  unit,
  property,
}: {
  view: CatalogView;
  unit: CatalogUnit;
  property: CatalogProperty;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const canMedia = useManagement().permissions["media"] === true;
  const [revision, setRevision] = useState(unit.revision);
  const [base, setBase] = useState<UnitForm>(() => unitFormFrom(unit));
  const [form, setForm] = useState<UnitForm>(base);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [gone, setGone] = useState(false);

  const errors = unitFormErrors(form);
  const hasErrors = Object.keys(errors).length > 0;
  const changes = unitChanges(base, form);
  const dirty = Object.keys(changes).length > 0;
  const whole = unit.kind === "whole_property";
  const archived = property.status === "archived";
  const readOnly = archived && !view.can_owner;
  const missing = missingForBooking(unit);
  const set = <K extends keyof UnitForm>(k: K, v: UnitForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // נתונים חדשים יותר מהרשימה (שינוי של משתמש אחר שהגיע ברענון) — רק כשאין שינויים שלא
  // נשמרו. הגרסה רק עולה: אחרי שמירה שלי הרשימה עדיין ישנה, ואסור לחזור אליה.
  useEffect(() => {
    if (unit.revision > revision && !dirty) {
      const latest = unitFormFrom(unit);
      setBase(latest);
      setForm(latest);
      setRevision(unit.revision);
    }
  }, [unit, revision, dirty]);

  // אחרי מחיקה: קודם יוצאים מהעמוד (בלי שאלת "לצאת בלי לשמור"), ואז מרעננים
  useEffect(() => {
    if (gone) void navigate({ to: "/manage/units" }).then(refresh);
  }, [gone, navigate, refresh]);

  /** מישהו אחר שינה בינתיים: הערכים העדכניים + השינויים שלי בשדות שהוא לא שינה */
  const applyLatest = (latestView: CatalogView, skipped: boolean) => {
    queryClient.setQueryData<CatalogView>(manageKeys.catalog, latestView);
    const latest = findUnit(latestView, unit.id);
    if (!latest) {
      setServerError(GONE_UNIT);
      return;
    }
    const latestForm = unitFormFrom(latest);
    const merged = mergeAfterConflict(UNIT_FORM_KEYS, base, form, latestForm);
    setBase(latestForm);
    setForm(merged.form);
    setRevision(latest.revision);
    setNotice({
      changed: merged.remoteChanged.map((k) => UNIT_FORM_LABELS[k]),
      dropped: merged.dropped.map((k) => UNIT_FORM_LABELS[k]),
      skipped,
    });
  };

  const save = async () => {
    if (hasErrors || !dirty || readOnly) return;
    setBusy(true);
    setServerError(null);
    try {
      const result = await hospitalityUpdateUnit({ data: { id: unit.id, changes, revision } });
      if (result.status === "saved") {
        setBase(form);
        setRevision(result.revision);
        setNotice(null);
        toast.success("היחידה נשמרה");
        refresh();
        return;
      }
      applyLatest(result.view, false);
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (active: boolean) => {
    setServerError(null);
    try {
      const result = await hospitalitySetUnitActive({ data: { id: unit.id, active, revision } });
      if (result.status === "conflict") return applyLatest(result.view, true);
      if (result.revision !== null) setRevision(result.revision);
      setNotice(null);
      toast.success(active ? "היחידה הופעלה" : "היחידה הושבתה");
      refresh();
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  const remove = async () => {
    setServerError(null);
    try {
      const result = await hospitalityDeleteUnit({ data: { id: unit.id, revision } });
      if (result.status === "conflict") return applyLatest(result.view, true);
      toast.success(`היחידה "${unit.name}" נמחקה`);
      setForm(base);
      setGone(true);
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  const err = (k: keyof UnitForm) => errors[k];
  const deactivateReason = deactivateBlock(property, unit);
  const activateReason = activateBlock(view, property);
  const deleteReason = unitDeleteBlock(property, unit);
  const members = whole
    ? physicalUnits(property).filter((u) => unit.member_ids?.includes(u.id))
    : [];

  return (
    <>
      <form
        className="mx-auto flex max-w-3xl flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <BackLink />
        <header className="flex flex-col gap-1">
          <h1 className="break-words text-2xl font-semibold">{unit.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>{whole ? "השכרת המתחם כולו" : UNIT_TYPE_LABELS[unit.unit_type]}</span>
            <span aria-hidden="true">·</span>
            <Link
              to="/manage/properties/$propertyId"
              params={{ propertyId: property.id }}
              className="font-medium text-primary hover:underline"
            >
              {property.name}
            </Link>
            <span className="sr-only">({PROPERTY_TYPE_LABELS[property.property_type]})</span>
            {unit.is_active ? (
              <StatusPill tone="ok">פעילה</StatusPill>
            ) : (
              <StatusPill tone="muted">לא פעילה</StatusPill>
            )}
          </p>
          {missing.length > 0 && (
            <p className="text-sm text-amber-800">
              עוד חסר כדי לקבל הזמנות: {missing.join(" ו")} — יתווספו בשלבים הבאים.
            </p>
          )}
        </header>

        <PageNotice error={serverError}>
          {notice && (
            <>
              <ConflictNotice
                title="היחידה עודכנה בינתיים על ידי משתמש אחר."
                changed={notice.changed}
                dropped={notice.dropped}
              />
              {notice.skipped && <p className="font-medium">הפעולה לא בוצעה — בדקו ונסו שוב.</p>}
            </>
          )}
        </PageNotice>

        {archived && (
          <p
            role="note"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {view.can_owner
              ? "המתחם של היחידה בארכיון — היחידה מושבתת. אפשר להחזיר את המתחם מהארכיון בעמוד המתחם."
              : ARCHIVED_FOR_MANAGER}
          </p>
        )}

        <fieldset disabled={readOnly} className="flex flex-col gap-5">
          <Card data-section="details">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>פרטים</h2>
              </CardTitle>
              <CardDescription>השם והתיאור שהאורחים יראו.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <TextField
                idPrefix="unit"
                name="name"
                label={UNIT_LABELS.name}
                required
                value={form.name}
                onChange={(v) => set("name", v)}
                error={err("name")}
                hint="שם חופשי — למשל צימר הגפן, סוויטת רויאל או חדר 101."
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
              <TextAreaField
                idPrefix="unit"
                name="description"
                label={UNIT_LABELS.description}
                value={form.description}
                onChange={(v) => set("description", v)}
                error={err("description")}
                hint="מה מיוחד ביחידה — נוף, ג׳קוזי, פרטיות."
              />
            </CardContent>
          </Card>

          <Card data-section="guests">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>אורחים</h2>
              </CardTitle>
              <CardDescription>כמה אורחים אפשר לארח, וכמה כלולים במחיר הבסיס.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
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
                hint="מעבר לזה — תוספת לכל אורח (במסך המחירים)"
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
              <NumberField
                idPrefix="unit"
                name="max_adults"
                label={`${UNIT_LABELS.max_adults} (לא חובה)`}
                min={1}
                max={100}
                value={form.max_adults}
                onChange={(v) => set("max_adults", v)}
                error={err("max_adults")}
                hint="ריק — רק המספר הכולל חל"
              />
              <NumberField
                idPrefix="unit"
                name="max_children"
                label={`${UNIT_LABELS.max_children} (לא חובה)`}
                min={0}
                max={100}
                value={form.max_children}
                onChange={(v) => set("max_children", v)}
                error={err("max_children")}
                hint="0 — היחידה לא מתאימה לילדים; ריק — בלי הגבלה נפרדת"
              />
            </CardContent>
          </Card>

          <Card data-section="rooms">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>חדרים ומיטות</h2>
              </CardTitle>
              <CardDescription>
                {whole
                  ? "המיטות נקבעות בכל אחת מהיחידות הכלולות."
                  : "חדרי שינה ורחצה, ומיטות לפי חדר — האורחים יראו בדיוק איך ישנים."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
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
                name="separate_toilets"
                label={UNIT_LABELS.separate_toilets}
                min={0}
                max={50}
                value={form.separate_toilets}
                onChange={(v) => set("separate_toilets", v)}
                error={err("separate_toilets")}
                hint="בנוסף לחדרי הרחצה"
              />
              {!whole && (
                <div className="sm:col-span-2">
                  <BedsEditor
                    rows={form.beds}
                    onChange={(v) => set("beds", v)}
                    capacity={/^\d+$/.test(form.capacity) ? Number(form.capacity) : null}
                    error={err("beds")}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {!whole && (
            <Card data-section="amenities">
              <CardHeader>
                <CardTitle className="text-lg">
                  <h2>מתקנים ביחידה</h2>
                </CardTitle>
                <CardDescription>
                  מה יש ביחידה עצמה (פרטי). מתקנים משותפים — בעמוד המתחם.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AmenityPicker
                  view={view}
                  scope="unit"
                  value={form.amenities}
                  onChange={(v) => set("amenities", v)}
                  readOnly={readOnly}
                  error={err("amenities")}
                />
              </CardContent>
            </Card>
          )}
        </fieldset>

        {whole && (
          <Card data-section="members">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>היחידות הכלולות</h2>
              </CardTitle>
              <CardDescription>הזמנה אחת שתופסת את כל היחידות האלה.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link
                      to="/manage/units/$unitId"
                      params={{ unitId: m.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                to="/manage/properties/$propertyId"
                params={{ propertyId: property.id }}
                hash="whole"
                className="w-fit text-sm font-medium text-primary hover:underline"
              >
                שינוי היחידות הכלולות או כיבוי ההשכרה — בעמוד המתחם
              </Link>
            </CardContent>
          </Card>
        )}

        {!whole && !readOnly && (
          <Card data-section="status">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>מצב היחידה</h2>
              </CardTitle>
              <CardDescription>
                {unit.is_active
                  ? "היחידה פעילה: תוצג לאורחים ותקבל הזמנות (כשהאתר יעלה)."
                  : "היחידה לא פעילה: לא מוצגת לאורחים ולא מקבלת הזמנות חדשות. הזמנות קיימות נשמרות."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {unit.is_active ? (
                <>
                  {deactivateReason && (
                    <p className="text-sm text-muted-foreground">{deactivateReason}.</p>
                  )}
                  <ConfirmButton
                    label="השבתת היחידה"
                    icon={<PowerOff className="size-4" aria-hidden="true" />}
                    disabled={Boolean(deactivateReason)}
                    title={`להשבית את ${unit.name}?`}
                    description={
                      <>
                        <p>היחידה לא תוצג לאורחים ולא תקבל הזמנות חדשות.</p>
                        <p>הזמנות קיימות נשמרות, ואפשר להפעיל אותה שוב בכל זמן.</p>
                      </>
                    }
                    confirmLabel="השבתה"
                    onConfirm={() => setActive(false)}
                  />
                </>
              ) : (
                <>
                  {activateReason && (
                    <p className="text-sm text-muted-foreground">{activateReason}</p>
                  )}
                  <Button
                    type="button"
                    className="min-h-11 w-fit gap-2"
                    disabled={Boolean(activateReason)}
                    onClick={() => void setActive(true)}
                  >
                    <Power className="size-4" aria-hidden="true" />
                    הפעלת היחידה
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!whole && view.can_owner && (
          <Card data-section="delete" className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>מחיקת היחידה</h2>
              </CardTitle>
              <CardDescription>
                לבעל העסק בלבד. מחיקה אפשרית רק ליחידה שאף פעם לא הוזמנה או נחסמה.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {deleteReason && <p className="text-sm text-muted-foreground">{deleteReason}.</p>}
              <ConfirmButton
                label="מחיקה לצמיתות"
                destructive
                icon={<Trash2 className="size-4" aria-hidden="true" />}
                disabled={Boolean(deleteReason)}
                title={`למחוק את ${unit.name} לצמיתות?`}
                description={<p>היחידה תימחק עם כל הפרטים שלה. אי אפשר לבטל את זה.</p>}
                confirmLabel="מחיקה לצמיתות"
                onConfirm={remove}
              />
            </CardContent>
          </Card>
        )}

        {!readOnly && (
          <SaveBar
            dirty={dirty}
            hasErrors={hasErrors}
            busy={busy}
            onReset={() => {
              setForm(base);
              setNotice(null);
            }}
          />
        )}
        <LeaveGuard dirty={dirty && !gone} what="היחידה" />
      </form>
      {/* מחוץ לטופס של העמוד: לגלריה פעולות משלה (כל פעולה נשמרת מיד) */}
      {!whole && canMedia && !gone && (
        <div id="gallery" className="mx-auto mt-5 flex max-w-3xl flex-col gap-5">
          <MediaGallery
            galleryRef={{ ownerKind: "unit", ownerId: unit.id }}
            title="תמונות היחידה"
            description="התמונה הראשית מוצגת ראשונה ברשימת היחידות ובאתר. כל שינוי נשמר מיד."
            canEdit={!readOnly}
          />
        </div>
      )}
    </>
  );
}
