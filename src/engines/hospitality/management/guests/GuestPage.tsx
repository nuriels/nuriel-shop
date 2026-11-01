// כרטיס אורח (/manage/guests/$guestId) — Stage 2j: פרטי קשר, הסכמה לדיוור, הערות פנימיות
// (נשמרות ביומן בלי התוכן), כל ההזמנות שלו; לבעלים בלבד — ייצוא הנתונים (קובץ JSON) ומחיקת
// הפרטים האישיים (ההזמנות והסכומים נשארים; לא אפשרי כשיש הזמנה פעילה או עתידית).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight, Download, Mail, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, cn } from "@/platform/ui";
import {
  hospitalityAnonymizeGuest,
  hospitalityExportGuest,
  hospitalityGuest,
  hospitalitySaveGuestNotes,
} from "../../api/guests.functions";
import type { GuestDetail } from "../../types/guests";
import { ConfirmButton, LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { STATE_LABELS, TONE_CLASS, dateTimeText, dayText, stateTone } from "../bookings/model";
import { manageKeys } from "../lib/query-keys";
import { money } from "../pricing/model";
import { useManagement } from "../shell/management-context";

const guestKey = (id: string) => [...manageKeys.all, "guest", id] as const;

export function GuestPage() {
  const { guestId } = useParams({ strict: false }) as { guestId: string };
  const ctx = useManagement();
  const query = useQuery({
    queryKey: guestKey(guestId),
    queryFn: () => hospitalityGuest({ data: { id: guestId } }),
  });
  if (!ctx.permissions["guests"])
    return <p className="p-4">אין לכם הרשאה לראות אורחים באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את כרטיס האורח…" />;
  return <Guest g={query.data} />;
}

function Guest({ g }: { g: GuestDetail }) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: guestKey(g.id) });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "guests"] });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "bookings"] });
  };
  const anonymized = Boolean(g.anonymized_at);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        to="/manage/guests"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
        חזרה לאורחים
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">{g.name}</h1>
        <p className="text-muted-foreground">אורח מ-{dateTimeText(g.created_at)}</p>
      </header>

      {anonymized ? (
        <p className="rounded-md bg-muted p-4 text-sm">
          הפרטים האישיים של האורח נמחקו ב-{dateTimeText(g.anonymized_at)}. ההזמנות והסכומים נשמרו.
        </p>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              <h2>פרטי קשר</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {g.phone && (
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                <a href={`tel:${g.phone}`} dir="ltr" className="text-primary hover:underline">
                  {g.phone}
                </a>
              </p>
            )}
            {g.email && (
              <p className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                <a href={`mailto:${g.email}`} dir="ltr" className="text-primary hover:underline">
                  {g.email}
                </a>
              </p>
            )}
            <p className="text-muted-foreground">
              {g.marketing_consent ? "הסכים/ה לקבל עדכונים ומבצעים." : "לא הסכים/ה לקבל דיוור."}
            </p>
          </CardContent>
        </Card>
      )}

      {!anonymized && <Notes g={g} onSaved={refresh} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            <h2>הזמנות ({g.bookings.length})</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y text-sm">
            {g.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  to="/manage/bookings/$bookingId"
                  params={{ bookingId: b.id }}
                  className="font-medium text-primary hover:underline"
                >
                  #{b.number} · {b.unit_name} · {dayText(b.check_in)}
                </Link>
                <span className="flex items-center gap-2">
                  {money(b.total, b.currency)}
                  <span
                    className={cn("rounded px-2 py-0.5 text-xs", TONE_CLASS[stateTone(b.state)])}
                  >
                    {STATE_LABELS[b.state]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {g.can_privacy && !anonymized && <Privacy g={g} onDone={refresh} />}
    </div>
  );
}

function Notes({ g, onSaved }: { g: GuestDetail; onSaved: () => void }) {
  const [notes, setNotes] = useState(g.notes ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = notes.trim() !== (g.notes ?? "");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2>הערות פנימיות</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Label htmlFor="guest-notes" className="text-sm text-muted-foreground">
          רק הצוות רואה את ההערות (למשל: מעדיפים קומה נמוכה, אלרגיה לבוטנים).
        </Label>
        <textarea
          id="guest-notes"
          value={notes}
          maxLength={2000}
          rows={4}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-md border border-input bg-background p-3 text-sm"
        />
        <Button
          type="button"
          className="min-h-11 w-fit"
          disabled={!dirty || busy}
          onClick={() => {
            setBusy(true);
            void hospitalitySaveGuestNotes({ data: { id: g.id, notes } })
              .then(() => {
                toast.success("ההערות נשמרו");
                onSaved();
              })
              .catch((e: unknown) => toast.error(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          שמירת ההערות
        </Button>
      </CardContent>
    </Card>
  );
}

function Privacy({ g, onDone }: { g: GuestDetail; onDone: () => void }) {
  const download = async () => {
    try {
      const data = await hospitalityExportGuest({ data: { id: g.id } });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `guest-${g.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("הקובץ ירד");
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  return (
    <Card data-section="privacy">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2>פרטיות (לבעלים בלבד)</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          לבקשת האורח: ייצוא כל המידע עליו, או מחיקת הפרטים האישיים. כל פעולה נרשמת ביומן.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-2"
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden="true" />
            ייצוא המידע (JSON)
          </Button>
          <ConfirmButton
            label="מחיקת הפרטים האישיים"
            icon={<Trash2 className="size-4" aria-hidden="true" />}
            title={`למחוק את הפרטים של ${g.name}?`}
            description={
              <p>
                השם, הטלפון, האימייל וההערות יימחקו לצמיתות. ההזמנות והסכומים נשארים (חובת שמירה).
                {g.active_bookings > 0 ? " לאורח יש הזמנה פעילה או עתידית — המחיקה תיחסם." : ""}
              </p>
            }
            confirmLabel="מחיקה לצמיתות"
            destructive
            onConfirm={async () => {
              try {
                await hospitalityAnonymizeGuest({ data: { id: g.id } });
                toast.success("הפרטים נמחקו");
                onDone();
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
