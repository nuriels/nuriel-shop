// "תנאים ופרטי החוזה" — מה שנכנס לחוזים של העסק הזה (מיגרציה 63): פרטי צד א' (נציג מורשה, מספר עוסק,
// חתימה), היחידות לסעיף 1 בחוזה האירוח, המתקנים, המכסות, שעות הבריכה, הפיקדון, דמי האיחור וימי
// הביטול. ברירות המחדל — המספרים שבחוזים המקוריים; כל עסק מתאים לעצמו. כל שמירה מבטלת את האישור,
// ובעל העסק מאשר שוב לפני שליחת חוזה. חוזים שכבר נשלחו לא משתנים (הערכים נקבעו ביום השליחה).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Input, Label, Textarea, cn } from "@/platform/ui";
import {
  hospitalityBusinessTerms,
  hospitalityBusinessTermsConfirm,
  hospitalityBusinessTermsSave,
} from "../../api/events.functions";
import { SignatureImage, SignaturePad } from "../../contracts/SignaturePad";
import type { ContractSignature } from "../../contracts/signature";
import type { BusinessTermsView } from "../../types/events";
import { EVENT_MAX_PARTICIPANTS } from "../../validation/events";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { TERMS_KEY } from "../events/model";
import { formatDateTime } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { SectionCard } from "../ui/kit";

interface Draft {
  representative_name: string;
  business_tax_id: string;
  facilities: string;
  facilities_definite: string;
  unit_lines: { unit_id: string | null; name: string; description: string }[];
  max_lodging_guests: string;
  max_event_guests: string;
  pool_open_time: string;
  pool_close_time: string;
  deposit_amount: string;
  event_late_fee_per_hour: string;
  lodging_late_fee_per_hour: string;
  free_cancellation_days: string;
}

const draftOf = (t: BusinessTermsView): Draft => ({
  representative_name: t.representative_name ?? "",
  business_tax_id: t.business_tax_id ?? "",
  facilities: t.facilities,
  facilities_definite: t.facilities_definite,
  unit_lines: t.unit_lines.map((l) => ({
    unit_id: l.unit_id ?? null,
    name: l.name,
    description: l.description,
  })),
  max_lodging_guests: String(t.max_lodging_guests),
  max_event_guests: String(t.max_event_guests),
  pool_open_time: t.pool_open_time,
  pool_close_time: t.pool_close_time,
  deposit_amount: String(t.deposit_amount),
  event_late_fee_per_hour: String(t.event_late_fee_per_hour),
  lodging_late_fee_per_hour: String(t.lodging_late_fee_per_hour),
  free_cancellation_days: String(t.free_cancellation_days),
});

/** "עד 5 אורחים" — מהנתונים של היחידה (לא ממציאים תיאור) */
const capacityText = (u: BusinessTermsView["units"][number]) => {
  const n = u.capacity ?? ((u.max_adults ?? 0) + (u.max_children ?? 0) || null);
  return n ? `עד ${n} אורחים` : "";
};

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TermsEditor() {
  const terms = useQuery({ queryKey: TERMS_KEY, queryFn: () => hospitalityBusinessTerms() });
  if (terms.isError && !terms.data) return <LoadError error={terms.error} />;
  if (!terms.data) return <PageSkeleton label="טוען את התנאים…" />;
  return <TermsForm key={terms.data.revision} terms={terms.data} />;
}

function TermsForm({ terms }: { terms: BusinessTermsView }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(terms));
  const [newSignature, setNewSignature] = useState<ContractSignature | null>(null);
  const [replaceSignature, setReplaceSignature] = useState(!terms.representative_signature);
  const [removeSignature, setRemoveSignature] = useState(false);
  const [checked, setChecked] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dirty =
    JSON.stringify(d) !== JSON.stringify(draftOf(terms)) ||
    (replaceSignature && newSignature !== null) ||
    removeSignature;
  const editable = terms.can_edit;

  const after = (t: BusinessTermsView) => {
    qc.setQueryData(TERMS_KEY, t);
    // התנאים מופיעים גם במסך החוזים ובמסך האירועים
    void qc.invalidateQueries({ queryKey: manageKeys.all });
  };
  const save = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const data: Record<string, unknown> = {
        representative_name: d.representative_name.trim() || null,
        business_tax_id: d.business_tax_id.trim() || null,
        facilities: d.facilities.trim(),
        facilities_definite: d.facilities_definite.trim(),
        unit_lines: d.unit_lines
          .map((l) => ({
            unit_id: l.unit_id,
            name: l.name.trim(),
            description: l.description.trim(),
          }))
          .filter((l) => l.name || l.description),
        max_lodging_guests: num(d.max_lodging_guests),
        max_event_guests: num(d.max_event_guests),
        pool_open_time: d.pool_open_time,
        pool_close_time: d.pool_close_time,
        deposit_amount: num(d.deposit_amount),
        event_late_fee_per_hour: num(d.event_late_fee_per_hour),
        lodging_late_fee_per_hour: num(d.lodging_late_fee_per_hour),
        free_cancellation_days: num(d.free_cancellation_days),
      };
      if (removeSignature) data["representative_signature"] = null;
      else if (replaceSignature && newSignature?.kind === "drawn")
        data["representative_signature"] = newSignature.paths;
      return hospitalityBusinessTermsSave({ data: { data, revision: terms.revision } });
    },
    onSuccess: (t) => {
      toast.success("התנאים נשמרו — בעל העסק צריך לאשר אותם שוב");
      after(t);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const confirm = useMutation({
    mutationFn: () => hospitalityBusinessTermsConfirm({ data: { revision: terms.revision } }),
    onSuccess: (t) => {
      toast.success("התנאים אושרו");
      after(t);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const missingUnits = terms.units.filter((u) => !d.unit_lines.some((l) => l.unit_id === u.id));
  const addUnits = () =>
    set("unit_lines", [
      ...d.unit_lines,
      ...missingUnits.map((u) => ({ unit_id: u.id, name: u.name, description: capacityText(u) })),
    ]);

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="terms-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (editable && dirty && !save.isPending) save.mutate();
      }}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm",
          terms.confirmed
            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
            : "border-amber-300 bg-amber-50 text-amber-950",
        )}
        data-testid="terms-status"
      >
        <p>
          {terms.confirmed ? (
            <>
              <CheckCircle2 className="me-1 inline size-4" aria-hidden="true" />
              בעל העסק אישר את התנאים
              {terms.confirmed_at ? ` (${formatDateTime(terms.confirmed_at)})` : ""}.
            </>
          ) : terms.saved ? (
            "התנאים נשמרו וממתינים לאישור בעל העסק."
          ) : (
            "עוד לא נשמרו תנאים — אלה ברירות המחדל מהחוזים המקוריים. בדקו, התאימו לעסק ושמרו."
          )}
        </p>
        {!editable && <p>צפייה בלבד — עריכה לבעלים ולמנהלים עם הרשאת הגדרות.</p>}
      </div>
      <p className="text-sm text-muted-foreground">
        מה שכאן נכנס לכל חוזה חדש. חוזה שכבר נשלח או נחתם לא משתנה — הערכים בו נקבעו ביום השליחה.
        שמירה מבטלת את האישור, ובעל העסק מאשר שוב.
      </p>

      <fieldset disabled={!editable || save.isPending} className="flex flex-col gap-4">
        <SectionCard title="צד א' — המשכיר" description="מופיע בראש שני החוזים ובחתימה">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="tr-rep" label="שם הנציג המורשה">
              <Input
                id="tr-rep"
                value={d.representative_name}
                maxLength={80}
                onChange={(e) => set("representative_name", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-tax" label="ח.פ / עוסק מורשה / עוסק פטור" hint="5 עד 9 ספרות">
              <Input
                id="tr-tax"
                value={d.business_tax_id}
                inputMode="numeric"
                dir="ltr"
                maxLength={20}
                aria-describedby="tr-tax-hint"
                onChange={(e) => set("business_tax_id", e.target.value)}
                className="min-h-11"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm font-medium">החתימה של הנציג (מופיעה ב-PDF החתום)</p>
            {terms.representative_signature && !replaceSignature && !removeSignature ? (
              <div className="flex flex-wrap items-center gap-3">
                <SignatureImage
                  paths={terms.representative_signature}
                  className="h-20 w-60 rounded-md border bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => setReplaceSignature(true)}
                >
                  חתימה חדשה
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10"
                  onClick={() => setRemoveSignature(true)}
                >
                  הסרה
                </Button>
              </div>
            ) : removeSignature ? (
              <p className="text-sm text-muted-foreground">
                החתימה תוסר בשמירה — ב-PDF יופיע שם הנציג בלבד.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setRemoveSignature(false)}
                >
                  ביטול
                </button>
              </p>
            ) : (
              <SignaturePad
                onChange={setNewSignature}
                allowTyped={false}
                label="חתימת הנציג המורשה"
                testId="representative-signature"
              />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="היחידות (סעיף 1 בחוזה האירוח)"
          description="כל שורה: שם היחידה ולמי היא מתאימה. היחידות שהוזמנו מסומנות בחוזה."
        >
          <ul className="flex flex-col gap-3" data-testid="terms-units">
            {d.unit_lines.map((l, i) => (
              <li
                key={i}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
              >
                <Field id={`tr-u${i}-name`} label="שם היחידה">
                  <Input
                    id={`tr-u${i}-name`}
                    value={l.name}
                    maxLength={60}
                    onChange={(e) =>
                      set(
                        "unit_lines",
                        d.unit_lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    className="min-h-11"
                  />
                </Field>
                <Field id={`tr-u${i}-desc`} label="למי מתאימה">
                  <Input
                    id={`tr-u${i}-desc`}
                    value={l.description}
                    maxLength={120}
                    onChange={(e) =>
                      set(
                        "unit_lines",
                        d.unit_lines.map((x, j) =>
                          j === i ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                    className="min-h-11"
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 gap-1"
                  onClick={() =>
                    set(
                      "unit_lines",
                      d.unit_lines.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  הסרה<span className="sr-only"> — {l.name || "השורה"}</span>
                </Button>
                {l.unit_id === null && (
                  <p className="text-xs text-muted-foreground sm:col-span-3">
                    שורה בלי יחידה במערכת — תופיע ברשימה, אבל לא תסומן כ"מוזמנת".
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingUnits.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-1.5"
                onClick={addUnits}
              >
                <Plus className="size-4" aria-hidden="true" />
                הוספת היחידות של העסק ({missingUnits.length})
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 gap-1.5"
              onClick={() =>
                set("unit_lines", [...d.unit_lines, { unit_id: null, name: "", description: "" }])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              שורה ידנית
            </Button>
          </div>
          {d.unit_lines.length === 0 && (
            <p className="mt-2 text-sm text-amber-900">בלי יחידות אי אפשר להפיק חוזה אירוח.</p>
          )}
        </SectionCard>

        <SectionCard title="המתקנים" description="בלשון החוזים: המתקנים שבמתחם ובאחריות השוכר">
          <div className="grid gap-3">
            <Field
              id="tr-fac"
              label="המתקנים (חוזה מתחם הבריכה, סעיף 1)"
              hint="למשל: מטבח חוץ, פינת מנגל, טרמפולינה ושולחן טניס"
            >
              <Textarea
                id="tr-fac"
                value={d.facilities}
                maxLength={300}
                rows={2}
                aria-describedby="tr-fac-hint"
                onChange={(e) => set("facilities", e.target.value)}
              />
            </Field>
            <Field
              id="tr-facd"
              label="המתקנים בסעיף ההתנהגות (ביידוע)"
              hint="למשל: פינת המנגל, מטבח החוץ, הטרמפולינה ושולחן הטניס"
            >
              <Textarea
                id="tr-facd"
                value={d.facilities_definite}
                maxLength={300}
                rows={2}
                aria-describedby="tr-facd-hint"
                onChange={(e) => set("facilities_definite", e.target.value)}
              />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="מספרים ושעות" description="ברירות המחדל — המספרים שבחוזים המקוריים">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="tr-mlg" label="מכסת אורחים ללינה">
              <Input
                id="tr-mlg"
                type="number"
                min={1}
                max={500}
                value={d.max_lodging_guests}
                onChange={(e) => set("max_lodging_guests", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-meg" label={`מכסת משתתפים באירוע (עד ${EVENT_MAX_PARTICIPANTS})`}>
              <Input
                id="tr-meg"
                type="number"
                min={1}
                max={EVENT_MAX_PARTICIPANTS}
                value={d.max_event_guests}
                onChange={(e) => set("max_event_guests", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-po" label="פתיחת הבריכה">
              <Input
                id="tr-po"
                type="time"
                value={d.pool_open_time}
                onChange={(e) => set("pool_open_time", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-pc" label="סגירת הבריכה">
              <Input
                id="tr-pc"
                type="time"
                value={d.pool_close_time}
                onChange={(e) => set("pool_close_time", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-dep" label="פיקדון / ערבות לנזקים, ₪">
              <Input
                id="tr-dep"
                type="number"
                min={0}
                value={d.deposit_amount}
                onChange={(e) => set("deposit_amount", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-elf" label="איחור בפינוי אירוע, ₪ לשעה">
              <Input
                id="tr-elf"
                type="number"
                min={0}
                value={d.event_late_fee_per_hour}
                onChange={(e) => set("event_late_fee_per_hour", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-llf" label="איחור ביציאה מלינה, ₪ לשעה">
              <Input
                id="tr-llf"
                type="number"
                min={0}
                value={d.lodging_late_fee_per_hour}
                onChange={(e) => set("lodging_late_fee_per_hour", e.target.value)}
                className="min-h-11"
              />
            </Field>
            <Field id="tr-fcd" label="ביטול בלי חיוב — עד כמה ימים לפני">
              <Input
                id="tr-fcd"
                type="number"
                min={0}
                max={365}
                value={d.free_cancellation_days}
                onChange={(e) => set("free_cancellation_days", e.target.value)}
                className="min-h-11"
              />
            </Field>
          </div>
        </SectionCard>
      </fieldset>

      {editable && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
          <Button
            type="submit"
            className="min-h-11"
            disabled={!dirty || save.isPending}
            data-testid="terms-save"
          >
            {save.isPending ? "שומר…" : "שמירת התנאים"}
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">יש שינויים שלא נשמרו</span>}
        </div>
      )}

      {terms.can_confirm && terms.saved && !terms.confirmed && (
        <SectionCard
          title="אישור בעל העסק"
          description="לפני שליחת חוזה ראשון — ושוב אחרי כל שינוי"
        >
          <div className="flex flex-col gap-3" data-testid="terms-confirm">
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={checked}
                disabled={dirty}
                onChange={(e) => setChecked(e.target.checked)}
              />
              בדקתי: פרטי צד א', היחידות, המתקנים, הפיקדון, דמי האיחור, שעות הבריכה וימי הביטול
              נכונים לעסק שלי, ואני מאשר/ת שהם ייכנסו לחוזים שנשלחים ללקוחות.
            </label>
            {dirty && <p className="text-sm text-muted-foreground">שמרו קודם את השינויים.</p>}
            <Button
              type="button"
              className="min-h-11 self-start"
              disabled={!checked || dirty || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? "מאשר…" : "אישור התנאים"}
            </Button>
          </div>
        </SectionCard>
      )}
      {!terms.can_confirm && terms.saved && !terms.confirmed && (
        <p className="text-sm text-muted-foreground">האישור — של בעל העסק בלבד.</p>
      )}
    </form>
  );
}
