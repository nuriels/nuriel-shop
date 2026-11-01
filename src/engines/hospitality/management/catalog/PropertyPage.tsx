// עמוד המתחם (/manage/properties/$propertyId) — Stage 2c.3: פרטי המתחם, היחידות שבו
// (וסידורן), "השכרת המתחם כולו" עם בחירת היחידות, וארכיון / החזרה / מחיקה (בעלים בלבד).
// שמירה עם הגרסה שנטענה; "עודכן בינתיים" — בלי לדרוס את השינוי של המשתמש האחר.
import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowUpDown, Loader2, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Switch,
  cn,
} from "@/platform/ui";
import {
  hospitalityArchiveProperty,
  hospitalityCatalog,
  hospitalityDeleteProperty,
  hospitalitySetWholeProperty,
  hospitalityUpdateProperty,
} from "../../api/catalog.functions";
import { PROPERTY_TYPES, type CatalogProperty, type CatalogView } from "../../types/catalog";
import { PROPERTY_LABELS, WHOLE_MEMBERS_ERROR } from "../../validation/catalog";
import { ChoiceField, SelectField, TextAreaField, TextField } from "../lib/fields";
import { manageKeys } from "../lib/query-keys";
import { ConflictNotice, UnitSheet } from "./CatalogSheets";
import { PROPERTY_TYPE_LABELS, UNIT_TYPE_LABELS } from "./labels";
import {
  ARCHIVED_FOR_MANAGER,
  GONE_PROPERTY,
  PROPERTY_FORM_KEYS,
  activeUnits,
  canRentWhole,
  findProperty,
  inactiveUnits,
  initialMembers,
  memberChoices,
  mergeAfterConflict,
  newUnitDefaults,
  physicalUnits,
  propertyChanges,
  propertyDeleteBlock,
  propertyFormErrors,
  propertyFormFrom,
  sameSet,
  unitSummary,
  unitsLimit,
  wholeRevision,
  wholeUnit,
  type PropertyForm,
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
import { UnitOrder } from "./UnitOrder";

export function PropertyPage() {
  const params = useParams({ strict: false }) as { propertyId?: string };
  const catalog = useQuery({
    queryKey: manageKeys.catalog,
    queryFn: () => hospitalityCatalog(),
    refetchOnWindowFocus: false,
  });
  if (catalog.isError) return <LoadError error={catalog.error} />;
  if (!catalog.data) return <PageSkeleton label="טוען את המתחם…" />;
  const view = catalog.data;
  const property = params.propertyId ? findProperty(view, params.propertyId) : null;
  if (!property) return <NotFound what="המתחם" />;
  return <PropertyEditor key={property.id} view={view} property={property} />;
}

interface Notice {
  changed: string[];
  dropped: string[];
  skipped: boolean;
}

function PropertyEditor({ view, property }: { view: CatalogView; property: CatalogProperty }) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(property.revision);
  const [base, setBase] = useState<PropertyForm>(() => propertyFormFrom(property));
  const [form, setForm] = useState<PropertyForm>(base);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [gone, setGone] = useState(false);
  const [wholeDirty, setWholeDirty] = useState(false);
  const [adding, setAdding] = useState(false);

  const errors = propertyFormErrors(form);
  const hasErrors = Object.keys(errors).length > 0;
  const changes = propertyChanges(base, form);
  const dirty = Object.keys(changes).length > 0;
  const archived = property.status === "archived";
  const readOnly = archived && !view.can_owner;
  const set = <K extends keyof PropertyForm>(k: K, v: PropertyForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // רק נתונים חדשים יותר (הגרסה רק עולה) — לא הרשימה הישנה שלפני הרענון
  useEffect(() => {
    if (property.revision > revision && !dirty) {
      const latest = propertyFormFrom(property);
      setBase(latest);
      setForm(latest);
      setRevision(property.revision);
    }
  }, [property, revision, dirty]);

  useEffect(() => {
    if (gone) void navigate({ to: "/manage/units" }).then(refresh);
  }, [gone, navigate, refresh]);

  const applyLatest = (latestView: CatalogView, skipped: boolean) => {
    queryClient.setQueryData<CatalogView>(manageKeys.catalog, latestView);
    const latest = findProperty(latestView, property.id);
    if (!latest) {
      setServerError(GONE_PROPERTY);
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
      skipped,
    });
  };

  const save = async () => {
    if (hasErrors || !dirty || readOnly) return;
    setBusy(true);
    setServerError(null);
    try {
      const result = await hospitalityUpdateProperty({
        data: { id: property.id, changes, revision },
      });
      if (result.status === "saved") {
        setBase(form);
        setRevision(result.revision);
        setNotice(null);
        toast.success("המתחם נשמר");
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

  const archive = async () => {
    setServerError(null);
    try {
      const result = await hospitalityArchiveProperty({ data: { id: property.id, revision } });
      if (result.status === "conflict") return applyLatest(result.view, true);
      if (result.revision !== null) setRevision(result.revision);
      setNotice(null);
      toast.success("המתחם הועבר לארכיון");
      refresh();
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  const restore = async () => {
    setServerError(null);
    try {
      const result = await hospitalityUpdateProperty({
        data: { id: property.id, changes: { status: "active" }, revision },
      });
      if (result.status === "conflict") return applyLatest(result.view, true);
      setRevision(result.revision);
      setNotice(null);
      toast.success(
        "המתחם הוחזר מהארכיון. היחידות שבו עדיין מושבתות — אפשר להפעיל כל אחת בעמוד שלה.",
      );
      refresh();
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  const remove = async () => {
    setServerError(null);
    try {
      const result = await hospitalityDeleteProperty({ data: { id: property.id, revision } });
      if (result.status === "conflict") return applyLatest(result.view, true);
      toast.success(`המתחם "${property.name}" נמחק`);
      setForm(base);
      setGone(true);
    } catch (e) {
      setServerError(errorText(e));
    }
  };

  const units = physicalUnits(property);
  const err = (k: keyof PropertyForm) => errors[k];
  const deleteReason = propertyDeleteBlock(property);

  // חלונית ההוספה מחוץ לטופס של העמוד — לטופס שלה שמירה משלה
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
          <h1 className="break-words text-2xl font-semibold">{property.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>{PROPERTY_TYPE_LABELS[property.property_type]}</span>
            <span aria-hidden="true">·</span>
            <span>{units.length === 1 ? "יחידה אחת" : `${units.length} יחידות`}</span>
            {property.status === "active" && <StatusPill tone="ok">פעיל</StatusPill>}
            {property.status === "draft" && <StatusPill tone="warn">טיוטה</StatusPill>}
            {archived && <StatusPill tone="muted">בארכיון</StatusPill>}
          </p>
        </header>

        <PageNotice error={serverError}>
          {notice && (
            <>
              <ConflictNotice
                title="המתחם עודכן בינתיים על ידי משתמש אחר."
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
              ? "המתחם בארכיון: לא מוצג ברשימה ולאורחים, והיחידות שבו מושבתות. אפשר להחזיר אותו — למטה."
              : ARCHIVED_FOR_MANAGER}
          </p>
        )}

        <fieldset disabled={readOnly}>
          <Card data-section="details">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>פרטי המתחם</h2>
              </CardTitle>
              <CardDescription>השם, הסוג, הכתובת והתיאור.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
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
              {!archived && (
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
              )}
            </CardContent>
          </Card>
        </fieldset>

        <UnitsCard
          view={view}
          property={property}
          readOnly={readOnly || archived}
          onAdd={() => setAdding(true)}
        />

        {!archived && canRentWhole(property) && (
          <WholePropertyCard property={property} onDirty={setWholeDirty} />
        )}

        {view.can_owner && (
          <Card data-section="owner" className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-lg">
                <h2>ארכיון ומחיקה</h2>
              </CardTitle>
              <CardDescription>לבעל העסק בלבד.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {archived ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    החזרה מהארכיון מחזירה את המתחם לרשימה. היחידות שבו נשארות מושבתות עד שתפעילו
                    אותן.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-fit gap-2"
                    onClick={() => void restore()}
                  >
                    <ArchiveRestore className="size-4" aria-hidden="true" />
                    החזרה מהארכיון
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    ארכיון — המתחם יוסתר והיחידות שבו יושבתו (המקומות בחבילה מתפנים). הזמנות קודמות
                    נשמרות, ואפשר להחזיר אותו בכל זמן.
                  </p>
                  <ConfirmButton
                    label="העברה לארכיון"
                    icon={<Archive className="size-4" aria-hidden="true" />}
                    title={`להעביר את ${property.name} לארכיון?`}
                    description={
                      <>
                        <p>המתחם לא יוצג ברשימה ולאורחים, וכל היחידות שבו יושבתו.</p>
                        <p>הזמנות קודמות נשמרות. אפשר להחזיר אותו מהארכיון בכל זמן.</p>
                      </>
                    }
                    confirmLabel="העברה לארכיון"
                    onConfirm={archive}
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {deleteReason ? `${deleteReason}.` : "מחיקה לצמיתות של המתחם וכל היחידות שבו."}
                </p>
                <ConfirmButton
                  label="מחיקה לצמיתות"
                  destructive
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  disabled={Boolean(deleteReason)}
                  title={`למחוק את ${property.name} לצמיתות?`}
                  description={<p>המתחם וכל היחידות שבו יימחקו. אי אפשר לבטל את זה.</p>}
                  confirmLabel="מחיקה לצמיתות"
                  onConfirm={remove}
                />
              </div>
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
        <LeaveGuard dirty={(dirty || wholeDirty) && !gone} what="המתחם" />
      </form>
      {adding && (
        <UnitSheet
          open
          view={view}
          unit={null}
          propertyId={property.id}
          defaults={newUnitDefaults(property)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

/** היחידות במתחם: קישור לכל יחידה, סידור, הוספה */
function UnitsCard({
  view,
  property,
  readOnly,
  onAdd,
}: {
  view: CatalogView;
  property: CatalogProperty;
  readOnly: boolean;
  onAdd: () => void;
}) {
  const [ordering, setOrdering] = useState(false);
  const active = activeUnits(property);
  const inactive = inactiveUnits(property);
  const whole = wholeUnit(property);
  const limit = unitsLimit(view.limits);
  return (
    <Card data-section="units">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>היחידות במתחם</h2>
        </CardTitle>
        <CardDescription>לחצו על יחידה כדי לראות ולשנות את כל הפרטים שלה.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ordering ? (
          <UnitOrder property={property} onDone={() => setOrdering(false)} />
        ) : (
          <>
            {active.length + inactive.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                אין עדיין יחידות במתחם הזה.
              </p>
            )}
            {[...active, ...inactive].length > 0 && (
              <ul className="divide-y rounded-md border">
                {[...active, ...inactive].map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center gap-2 p-3"
                    data-unit={u.name}
                  >
                    <Link
                      to="/manage/units/$unitId"
                      params={{ unitId: u.id }}
                      className="min-w-0 flex-1 font-medium text-primary hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {UNIT_TYPE_LABELS[u.unit_type]} · {unitSummary(u)}
                    </span>
                    {!u.is_active && <StatusPill tone="muted">לא פעילה</StatusPill>}
                  </li>
                ))}
                {whole && (
                  <li
                    className="flex flex-wrap items-center gap-2 bg-muted/30 p-3"
                    data-unit={whole.name}
                  >
                    <Link
                      to="/manage/units/$unitId"
                      params={{ unitId: whole.id }}
                      className="min-w-0 flex-1 font-medium text-primary hover:underline"
                    >
                      {whole.name}
                    </Link>
                    {whole.is_active ? (
                      <StatusPill tone="ok">פעיל</StatusPill>
                    ) : (
                      <StatusPill tone="muted">כבוי</StatusPill>
                    )}
                  </li>
                )}
              </ul>
            )}
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                {active.length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 gap-2"
                    onClick={() => setOrdering(true)}
                  >
                    <ArrowUpDown className="size-4" aria-hidden="true" />
                    סידור היחידות
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 gap-2"
                  disabled={!limit.canAdd}
                  onClick={onAdd}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  הוספת יחידה<span className="sr-only"> ל{property.name}</span>
                </Button>
              </div>
            )}
            {!readOnly && !canRentWhole(property) && (
              <p className="text-sm text-muted-foreground">
                "השכרת המתחם כולו" אפשרית כשיש במתחם לפחות שתי יחידות.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "השכרת המתחם כולו": מתג ובחירת היחידות; נשמר בנפרד מפרטי המתחם */
function WholePropertyCard({
  property,
  onDirty,
}: {
  property: CatalogProperty;
  onDirty: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const ids = useId();
  const whole = wholeUnit(property);
  const savedEnabled = Boolean(whole?.is_active);
  const savedMembers = whole?.member_ids ?? [];
  const [enabled, setEnabled] = useState(savedEnabled);
  const [members, setMembers] = useState<string[]>(() => initialMembers(property));
  const [revision, setRevision] = useState(wholeRevision(property));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const dirty = enabled !== savedEnabled || (enabled && !sameSet(members, savedMembers));
  const tooFew = enabled && members.length < 2;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // שינוי מבחוץ שהגיע ברענון — כשאין בחירה שלא נשמרה, ורק גרסה חדשה יותר (לא הרשימה
  // הישנה שלפני הרענון אחרי שמירה שלי)
  const latestRevision = wholeRevision(property);
  useEffect(() => {
    if (latestRevision !== null && (revision === null || latestRevision > revision) && !dirty) {
      setEnabled(Boolean(wholeUnit(property)?.is_active));
      setMembers(initialMembers(property));
      setRevision(latestRevision);
    }
  }, [latestRevision, revision, dirty, property]);

  const toggle = (id: string, on: boolean) =>
    setMembers((m) => (on ? [...m.filter((x) => x !== id), id] : m.filter((x) => x !== id)));

  const save = async () => {
    if (tooFew) return setMessage({ error: true, text: WHOLE_MEMBERS_ERROR });
    setBusy(true);
    setMessage(null);
    try {
      const result = await hospitalitySetWholeProperty({
        data: {
          propertyId: property.id,
          enabled,
          memberIds: enabled ? members : [],
          revision,
        },
      });
      if (result.status === "conflict") {
        queryClient.setQueryData<CatalogView>(manageKeys.catalog, result.view);
        const latest = findProperty(result.view, property.id);
        if (latest) {
          setEnabled(Boolean(wholeUnit(latest)?.is_active));
          setMembers(initialMembers(latest));
          setRevision(wholeRevision(latest));
        }
        setMessage({ error: false, text: result.message });
        return;
      }
      setRevision(result.revision);
      toast.success(
        !enabled
          ? "השכרת המתחם כולו כובתה"
          : savedEnabled
            ? 'היחידות של "כל המתחם" עודכנו'
            : "השכרת המתחם כולו הופעלה",
      );
      refresh();
    } catch (e) {
      setMessage({ error: true, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="whole" data-section="whole" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>השכרת המתחם כולו</h2>
        </CardTitle>
        <CardDescription>
          אורחים יוכלו להזמין את כל היחידות שתבחרו בהזמנה אחת. כשהמתחם מוזמן כולו — היחידות האלה לא
          פנויות להזמנה נפרדת, וכשיחידה מהן מוזמנת — אי אפשר להזמין את המתחם כולו באותם תאריכים.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`${ids}-switch`}
            checked={enabled}
            disabled={busy}
            onCheckedChange={(on) => {
              setEnabled(on);
              setMessage(null);
            }}
          />
          <Label htmlFor={`${ids}-switch`} className="text-base">
            השכרת המתחם כולו
          </Label>
          <span className="text-sm text-muted-foreground">{enabled ? "פעילה" : "כבויה"}</span>
        </div>

        {enabled && (
          <fieldset disabled={busy} className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">
              היחידות שנכללות בהשכרה (לפחות שתיים)
            </legend>
            {memberChoices(property).map(({ unit, disabledReason }) => {
              const id = `${ids}-${unit.id}`;
              return (
                <div
                  key={unit.id}
                  className={cn(
                    "flex min-h-11 items-start gap-3 rounded-md border p-3",
                    members.includes(unit.id) && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={members.includes(unit.id)}
                    disabled={Boolean(disabledReason)}
                    aria-describedby={`${id}-hint`}
                    onCheckedChange={(c) => toggle(unit.id, c === true)}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor={id} className="font-medium">
                      {unit.name}
                    </Label>
                    <span id={`${id}-hint`} className="text-xs text-muted-foreground">
                      {disabledReason ?? unitSummary(unit)}
                    </span>
                  </div>
                </div>
              );
            })}
            {tooFew && <p className="text-sm text-destructive">{WHOLE_MEMBERS_ERROR}</p>}
          </fieldset>
        )}

        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={cn(
              "rounded-md border p-3 text-sm",
              message.error
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-primary/30 bg-primary/5",
            )}
          >
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-11 gap-2"
            disabled={!dirty || tooFew || busy}
            onClick={() => void save()}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            שמירת ההשכרה
          </Button>
          {whole && (
            <Link
              to="/manage/units/$unitId"
              params={{ unitId: whole.id }}
              className="text-sm font-medium text-primary hover:underline"
            >
              הפרטים של "כל המתחם" (שם, אורחים, תיאור)
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
