// מסך הגדרות העסק (/manage/settings). מוצגים רק השדות שהמשתמש רשאי לערוך (המסד
// מחליט — settings_view.editable); ההרשאה נאכפת שוב במסד בשמירה. שמירה עם הגרסה
// שנטענה; אם מישהו אחר שמר בינתיים — מיזוג בלי לדרוס את השינוי שלו.
import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Loader2, TriangleAlert } from "lucide-react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/platform/ui";
import { hospitalitySettings, hospitalityUpdateSettings } from "../../api/settings.functions";
import type { SettingsKey, SettingsView } from "../../types/settings";
import { SETTINGS_LABELS } from "../../validation/settings";
import { manageKeys } from "../lib/query-keys";
import {
  APPROVAL_HOURS,
  NIGHT_LABELS,
  OPEN_REQUESTS,
  REMINDER_PCT,
  RETENTION_MONTHS,
  buildChanges,
  changedFields,
  formErrors,
  formFromValues,
  hoursText,
  mergeAfterConflict,
  retentionText,
  visibleSections,
  type FormValues,
} from "./model";
import { DaysField, EmailListField, SelectField, TextField } from "./fields";

interface Notice {
  remoteChanged: SettingsKey[];
  dropped: SettingsKey[];
}

const labels = (keys: SettingsKey[]) => keys.map((k) => SETTINGS_LABELS[k]).join(", ");
const withCurrent = <T extends number | null>(list: T[], current: T) =>
  list.includes(current) ? list : [...list, current].sort((a, b) => (a ?? 0) - (b ?? 0));

export function SettingsPage() {
  const settings = useQuery({
    queryKey: manageKeys.settings,
    queryFn: () => hospitalitySettings(),
    refetchOnWindowFocus: false,
  });
  if (settings.isError) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-md border border-destructive/40 p-4 text-destructive"
      >
        {settings.error instanceof Error ? settings.error.message : "טעינת ההגדרות נכשלה"}
      </div>
    );
  }
  if (!settings.data) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <span className="sr-only">טוען את ההגדרות…</span>
      </div>
    );
  }
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: SettingsView }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState(initial);
  const [base, setBase] = useState(() => formFromValues(initial.values));
  const [form, setForm] = useState(base);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const editable = view.editable;
  const sections = useMemo(() => visibleSections(editable), [editable]);
  const dirty = changedFields(base, form, editable).length > 0;
  const errors = formErrors(base, form, editable);
  const hasErrors = Object.keys(errors).length > 0;

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  useEffect(() => {
    if (notice || serverError) noticeRef.current?.focus();
  }, [notice, serverError]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const applyView = (next: SettingsView) => {
    const values = formFromValues(next.values);
    setView(next);
    setBase(values);
    setForm(values);
    queryClient.setQueryData(manageKeys.settings, next);
  };

  const save = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const result = await hospitalityUpdateSettings({
        data: { changes: buildChanges(base, form, editable), revision: view.revision },
      });
      if (result.status === "saved") {
        applyView(result.view);
        setNotice(null);
        toast.success("ההגדרות נשמרו");
        void queryClient.invalidateQueries({ queryKey: manageKeys.context });
        return;
      }
      // מישהו אחר שמר בינתיים: הערכים העדכניים + השינויים שלי בשדות שהוא לא שינה
      const latest = formFromValues(result.view.values);
      const merged = mergeAfterConflict(base, form, latest, result.view.editable);
      setView(result.view);
      setBase(latest);
      setForm(merged.form);
      queryClient.setQueryData(manageKeys.settings, result.view);
      setNotice({ remoteChanged: merged.remoteChanged, dropped: merged.dropped });
    } catch (error) {
      setServerError(
        error instanceof Error && error.message ? error.message : "השמירה נכשלה — נסו שוב",
      );
    } finally {
      setBusy(false);
    }
  };

  const err = (k: SettingsKey) => errors[k];

  return (
    <form
      className="mx-auto flex max-w-3xl flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !hasErrors && !busy) void save();
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold">הגדרות העסק</h1>
        <p className="mt-1 text-muted-foreground">
          הפרטים והכללים של העסק. השינויים נשמרים רק אחרי "שמירה".
        </p>
      </div>

      {(notice || serverError) && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          role={serverError ? "alert" : "status"}
          className={
            serverError
              ? "flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
              : "flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm"
          }
        >
          {serverError ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {serverError ? (
            <p>{serverError}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                ההגדרות עודכנו בינתיים על ידי משתמש אחר. הטופס עודכן לערכים העדכניים.
              </p>
              {notice!.remoteChanged.length > 0 && (
                <p>שונו בינתיים: {labels(notice!.remoteChanged)}.</p>
              )}
              {notice!.dropped.length > 0 && (
                <p>
                  השינוי שלך ב{labels(notice!.dropped)} לא נשמר, כי גם המשתמש האחר שינה את השדה —
                  בדקו ושנו שוב אם צריך.
                </p>
              )}
              <p>שאר השינויים שלך עדיין בטופס — לחצו "שמירה" כדי לשמור אותם.</p>
            </div>
          )}
        </div>
      )}

      {sections.map((section) => (
        <Card key={section.key} data-section={section.key}>
          <CardHeader>
            <CardTitle className="text-lg">
              <h2>{section.title}</h2>
            </CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {section.fields.map((k) => (
              <div
                key={k}
                className={
                  k === "weekend_nights" || k === "notification_emails" || k === "address"
                    ? "md:col-span-2"
                    : ""
                }
              >
                {k === "business_name" && (
                  <TextField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    required
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    autoComplete="organization"
                  />
                )}
                {(k === "contact_phone" || k === "whatsapp_phone") && (
                  <TextField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    type="tel"
                    dir="ltr"
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="למשל 050-1234567"
                    autoComplete="tel"
                  />
                )}
                {k === "contact_email" && (
                  <TextField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    type="email"
                    dir="ltr"
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    autoComplete="email"
                  />
                )}
                {k === "address" && (
                  <TextField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    autoComplete="street-address"
                  />
                )}
                {(k === "check_in_time" || k === "check_out_time") && (
                  <TextField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    type="time"
                    dir="ltr"
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                  />
                )}
                {k === "approval_window_minutes" && (
                  <SelectField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="אם לא תאשרו בזמן הזה, הבקשה תפוג והתאריכים ישתחררו."
                    options={withCurrent(
                      APPROVAL_HOURS.map((h) => h * 60),
                      form[k],
                    ).map((m) => ({ value: m, label: hoursText(m) }))}
                  />
                )}
                {k === "approval_reminder_pct" && (
                  <SelectField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="מתי לשלוח לכם תזכורת על בקשה שעוד לא אושרה."
                    options={withCurrent(REMINDER_PCT, form[k]).map((p) => ({
                      value: p,
                      label: `אחרי ${p}% מהזמן`,
                    }))}
                  />
                )}
                {k === "max_open_requests" && (
                  <SelectField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="כמה בקשות ממתינות אורח אחד יכול לשלוח בבת אחת."
                    options={OPEN_REQUESTS.map((n) => ({
                      value: n,
                      label: n === 1 ? "בקשה אחת" : `${n} בקשות`,
                    }))}
                  />
                )}
                {k === "weekend_nights" && (
                  <DaysField
                    name={k}
                    label="לילות סוף שבוע (לתמחור)"
                    labels={NIGHT_LABELS.map((d) => `ליל ${d}`)}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="הלילות שיקבלו את מחיר סוף השבוע."
                  />
                )}
                {k === "notification_emails" && (
                  <EmailListField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    max={5}
                    error={err(k)}
                  />
                )}
                {k === "guest_retention_months" && (
                  <SelectField
                    name={k}
                    label={SETTINGS_LABELS[k]}
                    value={form[k]}
                    onChange={(v) => set(k, v)}
                    error={err(k)}
                    hint="אורח עם הזמנה פעילה או עתידית לא נמחק."
                    options={withCurrent(RETENTION_MONTHS, form[k]).map((m) => ({
                      value: m,
                      label: retentionText(m),
                    }))}
                  />
                )}
              </div>
            ))}
            {section.key === "rules" && (
              <p className="text-sm text-muted-foreground md:col-span-2">
                הזמנות מהאתר מתקבלות כבקשה לאישור. המחירים בשקלים, לפי שעון ישראל. הזמנה מיידית
                ותשלום באתר יתווספו בהמשך.
              </p>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-[4.5rem] z-30 flex items-center gap-3 rounded-lg border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
        <p className="flex-1 text-sm text-muted-foreground" aria-live="polite">
          {hasErrors ? "יש שדות לתיקון" : dirty ? "יש שינויים שלא נשמרו" : "אין שינויים"}
        </p>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={!dirty || busy}
          onClick={() => setForm(base)}
        >
          ביטול
        </Button>
        <Button type="submit" className="min-h-11 gap-2" disabled={!dirty || hasErrors || busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          שמירה
        </Button>
      </div>

      <AlertDialog open={blocker.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>לצאת בלי לשמור?</AlertDialogTitle>
            <AlertDialogDescription>
              יש שינויים בהגדרות שעוד לא נשמרו. אם תצאו, הם יימחקו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" onClick={() => blocker.reset?.()}>
              להישאר ולשמור
            </AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => blocker.proceed?.()}>
              לצאת בלי לשמור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
