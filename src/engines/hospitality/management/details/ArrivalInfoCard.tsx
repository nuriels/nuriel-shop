// מידע פרטי להגעה (Stage 2d): קוד כניסה, קוד שער, Wi-Fi והוראות הגעה — למתחם כולו או לכל
// יחידה. נשמר בנפרד מהטופס של העמוד (שמירה משלו, גרסה משלו), לא נכנס ל-catalog_view, ומוצג
// רק לצוות עם הרשאה. ביומן הפעולות נרשם איזה שדה השתנה — לעולם לא הערך. לאורח: רק בהזמנה
// מאושרת, מ-48 שעות לפני הכניסה ועד היציאה (guest_arrival_info — המסך לאורח בשלב 4 / 6).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@/platform/ui";
import { hospitalityArrivalInfo, hospitalitySaveArrivalInfo } from "../../api/details.functions";
import {
  ARRIVAL_KEYS,
  type ArrivalInfoView,
  type ArrivalKey,
  type ArrivalRecord,
  type ArrivalValues,
} from "../../types/catalog";
import { ARRIVAL_LABELS, arrivalError } from "../../validation/details";
import { manageKeys } from "../lib/query-keys";
import { errorText } from "../catalog/refresh";

type Form = Record<ArrivalKey, string>;
const formOf = (r: ArrivalRecord | null): Form =>
  Object.fromEntries(ARRIVAL_KEYS.map((k) => [k, r?.[k] ?? ""])) as Form;
const recordOf = (view: ArrivalInfoView, target: string): ArrivalRecord | null =>
  target === "" ? view.property : (view.units.find((u) => u.unit_id === target)?.info ?? null);
const SECRET: readonly ArrivalKey[] = ["entry_code", "gate_code", "wifi_password"];

export function ArrivalInfoCard(props: { propertyId: string; onDirty: (dirty: boolean) => void }) {
  const query = useQuery({
    queryKey: manageKeys.arrival(props.propertyId),
    queryFn: () => hospitalityArrivalInfo({ data: { propertyId: props.propertyId } }),
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  return (
    <Card data-section="arrival-info" id="arrival-info">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Lock className="size-4" aria-hidden="true" />
          <h2>מידע פרטי להגעה</h2>
        </CardTitle>
        <CardDescription>
          קודים וסיסמאות — לא מוצגים באתר. האורח יקבל אותם רק אחרי אישור ההזמנה, מ-48 שעות לפני
          הכניסה ועד היציאה. ביומן הפעולות נרשם רק מה השתנה, בלי הערכים.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isError && <p className="text-sm text-destructive">{errorText(query.error)}</p>}
        {!query.data && !query.isError && <p className="text-sm text-muted-foreground">טוען…</p>}
        {query.data && <ArrivalEditor view={query.data} onDirty={props.onDirty} />}
      </CardContent>
    </Card>
  );
}

function ArrivalEditor({
  view,
  onDirty,
}: {
  view: ArrivalInfoView;
  onDirty: (d: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(""); // "" = המתחם כולו
  const record = recordOf(view, target);
  const [base, setBase] = useState<Form>(() => formOf(record));
  const [form, setForm] = useState<Form>(base);
  const [revision, setRevision] = useState<number | null>(record?.revision ?? null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = JSON.stringify(base) !== JSON.stringify(form);
  const errors = Object.fromEntries(
    ARRIVAL_KEYS.map((k) => [k, arrivalError(k, form[k])]).filter(([, e]) => e),
  ) as Partial<Record<ArrivalKey, string>>;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const load = (v: ArrivalInfoView, t: string) => {
    const r = recordOf(v, t);
    const f = formOf(r);
    setBase(f);
    setForm(f);
    setRevision(r?.revision ?? null);
  };

  const save = async () => {
    if (!dirty || Object.keys(errors).length > 0) return;
    setBusy(true);
    setMessage(null);
    const values: Partial<ArrivalValues> = {};
    for (const k of ARRIVAL_KEYS)
      if (form[k] !== base[k]) values[k] = form[k].trim() === "" ? null : form[k];
    try {
      const result = await hospitalitySaveArrivalInfo({
        data: {
          propertyId: view.property_id,
          unitId: target === "" ? null : target,
          values,
          revision,
        },
      });
      if (result.status === "conflict") {
        queryClient.setQueryData(manageKeys.arrival(view.property_id), result.view);
        load(result.view, target);
        setMessage(
          "המידע עודכן בינתיים על ידי משתמש אחר — מוצגים הערכים העדכניים, והשינוי שלכם לא נשמר.",
        );
        return;
      }
      setBase(form);
      setRevision(result.revision);
      toast.success("המידע הפרטי נשמר");
      void queryClient.invalidateQueries({ queryKey: manageKeys.arrival(view.property_id) });
      void queryClient.invalidateQueries({ queryKey: manageKeys.activity });
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !view.can_edit;
  return (
    <div className="flex flex-col gap-4" data-testid="arrival-editor">
      {view.units.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="arrival-target">למי המידע</Label>
          <select
            id="arrival-target"
            value={target}
            disabled={dirty}
            onChange={(e) => {
              setTarget(e.target.value);
              load(view, e.target.value);
              setMessage(null);
            }}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm"
          >
            <option value="">המתחם כולו (שער, Wi-Fi משותף)</option>
            {view.units.map((u) => (
              <option key={u.unit_id} value={u.unit_id}>
                {u.name}
                {u.info ? " — יש מידע" : ""}
              </option>
            ))}
          </select>
          {dirty && (
            <p className="text-xs text-muted-foreground">שמרו או בטלו את השינויים כדי לעבור.</p>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {ARRIVAL_KEYS.filter((k) => k !== "instructions").map((k) => {
          const id = `arrival-${k}`;
          return (
            <div key={k} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{ARRIVAL_LABELS[k]}</Label>
              <Input
                id={id}
                dir="ltr"
                autoComplete="off"
                type={SECRET.includes(k) && !shown ? "password" : "text"}
                value={form[k]}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                aria-invalid={errors[k] ? true : undefined}
                className="min-h-11 text-start"
              />
              {errors[k] && <p className="text-sm text-destructive">{errors[k]}</p>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="arrival-instructions">{ARRIVAL_LABELS.instructions}</Label>
        <Textarea
          id="arrival-instructions"
          rows={3}
          value={form.instructions}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
          className="text-base"
        />
        {errors.instructions && <p className="text-sm text-destructive">{errors.instructions}</p>}
      </div>
      {message && (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 gap-2"
          onClick={() => setShown((s) => !s)}
        >
          {shown ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
          {shown ? "הסתרת הקודים" : "הצגת הקודים"}
        </Button>
        {!readOnly && (
          <>
            <Button
              type="button"
              className="min-h-11 gap-2"
              disabled={!dirty || busy || Object.keys(errors).length > 0}
              onClick={() => void save()}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              שמירת המידע הפרטי
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setForm(base)}
              >
                ביטול השינויים
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
