// עמוד ההזמנה — Stage 2i: שינוי ההזמנה (תאריכים, יחידה, אורחים, מחיר ידני), ביטול ע"י העסק
// (דמי ביטול לפי המדיניות שנשמרה, או סכום אחר עם סיבה), ובקשת ביטול של אורח (אישור — עם
// אפשרות להפחית / לוותר על הדמי, או דחייה עם הסבר לאורח). הכול נבדק ונחשב במסד.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from "@/platform/ui";
import {
  hospitalityApproveCancellation,
  hospitalityCancelBooking,
  hospitalityCancellationQuote,
  hospitalityDeclineCancellation,
  hospitalityModifyBooking,
} from "../../api/bookings.functions";
import { hospitalityPricing } from "../../api/pricing.functions";
import type { BookingDetail } from "../../types/bookings";
import { FormSheet } from "../catalog/CatalogSheets";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { money } from "../pricing/model";
import { useBookingRefresh } from "./refresh";
import { dateTimeText } from "./model";

const field = "flex flex-col gap-1.5";
const select = "min-h-11 rounded-md border border-input bg-background px-3";

export function BookingChanges({
  b,
  onError,
}: {
  b: BookingDetail;
  onError: (m: string | null) => void;
}) {
  const [sheet, setSheet] = useState<"modify" | "cancel" | null>(null);
  const canModify = ["pending_approval", "pending_payment", "confirmed", "checked_in"].includes(
    b.state,
  );
  const canCancel = b.state === "confirmed";
  return (
    <>
      {b.state === "cancel_requested" && <CancellationRequest b={b} onError={onError} />}
      {(canModify || canCancel) && (
        <div className="flex flex-wrap gap-2" data-section="changes">
          {canModify && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => setSheet("modify")}
            >
              <Pencil className="size-4" aria-hidden="true" />
              שינוי ההזמנה
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setSheet("cancel")}
            >
              <Ban className="size-4" aria-hidden="true" />
              ביטול ההזמנה
            </Button>
          )}
        </div>
      )}
      {sheet === "modify" && <ModifySheet b={b} onClose={() => setSheet(null)} />}
      {sheet === "cancel" && <CancelSheet b={b} onClose={() => setSheet(null)} />}
    </>
  );
}

function ModifySheet({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const refresh = useBookingRefresh(b.id);
  const pricing = useQuery({
    queryKey: [...manageKeys.all, "pricing"],
    queryFn: () => hospitalityPricing(),
    refetchOnWindowFocus: false,
  });
  const [f, setF] = useState({
    unitId: b.unit.id,
    checkIn: b.check_in,
    checkOut: b.check_out,
    adults: b.adults,
    children: b.children,
    manual: false,
    total: String(b.total),
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = f.checkOut <= f.checkIn ? "תאריך העזיבה חייב להיות אחרי תאריך ההגעה" : null;
  const units = (pricing.data?.units ?? []).filter((u) => u.is_active || u.id === b.unit.id);
  return (
    <FormSheet
      open
      title={`שינוי הזמנה #${b.number}`}
      description="המחיר מחושב מחדש לפי התאריכים והאורחים, אלא אם קובעים מחיר ידני. שינוי לתאריכים תפוסים נדחה."
      dirty
      busy={busy}
      submitLabel="שמירת השינוי"
      serverError={error}
      notice={null}
      hasErrors={Boolean(invalid)}
      submitted
      onClose={onClose}
      onSubmit={() => {
        if (invalid) return;
        setBusy(true);
        setError(null);
        void hospitalityModifyBooking({
          data: {
            id: b.id,
            revision: b.revision,
            checkIn: f.checkIn,
            checkOut: f.checkOut,
            unitId: f.unitId === b.unit.id ? null : f.unitId,
            adults: f.adults,
            children: f.children,
            totalOverride: f.manual ? f.total : null,
            note: f.note,
          },
        })
          .then((r) => {
            const total = Number(r.total ?? b.total);
            toast.success(
              total === b.total
                ? "ההזמנה עודכנה"
                : `ההזמנה עודכנה — מחיר חדש ${money(total, b.currency)} (קודם ${money(b.total, b.currency)})`,
            );
            refresh();
            onClose();
          })
          .catch((e: unknown) => {
            setError(errorText(e));
            refresh();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className={field}>
        <Label htmlFor="md-unit">יחידה</Label>
        <select
          id="md-unit"
          className={select}
          value={f.unitId}
          onChange={(e) => setF((x) => ({ ...x, unitId: e.target.value }))}
        >
          {units.length === 0 && <option value={b.unit.id}>{b.unit.name}</option>}
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={field}>
          <Label htmlFor="md-in">הגעה</Label>
          <Input
            id="md-in"
            type="date"
            dir="ltr"
            value={f.checkIn}
            onChange={(e) => setF((x) => ({ ...x, checkIn: e.target.value }))}
            className="min-h-11"
          />
        </div>
        <div className={field}>
          <Label htmlFor="md-out">עזיבה</Label>
          <Input
            id="md-out"
            type="date"
            dir="ltr"
            value={f.checkOut}
            onChange={(e) => setF((x) => ({ ...x, checkOut: e.target.value }))}
            className="min-h-11"
          />
        </div>
        <div className={field}>
          <Label htmlFor="md-adults">מבוגרים</Label>
          <Input
            id="md-adults"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={f.adults}
            onChange={(e) => setF((x) => ({ ...x, adults: Number(e.target.value) || 1 }))}
            className="min-h-11"
          />
        </div>
        <div className={field}>
          <Label htmlFor="md-children">ילדים</Label>
          <Input
            id="md-children"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={f.children}
            onChange={(e) => setF((x) => ({ ...x, children: Number(e.target.value) || 0 }))}
            className="min-h-11"
          />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox
          checked={f.manual}
          onCheckedChange={(v) => setF((x) => ({ ...x, manual: v === true }))}
        />
        מחיר ידני (במקום החישוב)
      </label>
      {f.manual && (
        <div className={field}>
          <Label htmlFor="md-total">סה״כ להזמנה</Label>
          <Input
            id="md-total"
            type="number"
            inputMode="decimal"
            min={0}
            dir="ltr"
            value={f.total}
            onChange={(e) => setF((x) => ({ ...x, total: e.target.value }))}
            className="min-h-11"
          />
        </div>
      )}
      <div className={field}>
        <Label htmlFor="md-note">הערה להיסטוריה (לא חובה)</Label>
        <Input
          id="md-note"
          value={f.note}
          maxLength={1000}
          onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))}
          className="min-h-11"
        />
      </div>
      {invalid && <p className="text-sm text-destructive">{invalid}</p>}
    </FormSheet>
  );
}

function CancelSheet({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const refresh = useBookingRefresh(b.id);
  const quote = useQuery({
    queryKey: [...manageKeys.all, "cancel-quote", b.id, b.revision],
    queryFn: () => hospitalityCancellationQuote({ data: { id: b.id } }),
    refetchOnWindowFocus: false,
  });
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [fee, setFee] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = override && (fee === "" || !overrideReason.trim()) ? "יש לכתוב סכום וסיבה" : null;
  return (
    <FormSheet
      open
      title={`ביטול הזמנה #${b.number}`}
      description="התאריכים יתפנו מיד, והאורח יקבל מייל על הביטול."
      dirty
      busy={busy}
      submitLabel="ביטול ההזמנה"
      serverError={error}
      notice={null}
      hasErrors={Boolean(invalid)}
      submitted
      onClose={onClose}
      onSubmit={() => {
        if (invalid) return;
        setBusy(true);
        setError(null);
        void hospitalityCancelBooking({
          data: {
            id: b.id,
            revision: b.revision,
            reason,
            feeOverride: override ? fee : null,
            overrideReason: override ? overrideReason : null,
          },
        })
          .then(() => {
            toast.success("ההזמנה בוטלה");
            refresh();
            onClose();
          })
          .catch((e: unknown) => {
            setError(errorText(e));
            refresh();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="rounded-md bg-muted p-3 text-sm" data-testid="cancel-quote">
        {quote.isPending ? (
          "מחשבים את דמי הביטול לפי המדיניות…"
        ) : quote.isError ? (
          errorText(quote.error)
        ) : (
          <>
            <p>
              לפי המדיניות שנשמרה עם ההזמנה: דמי ביטול <b>{money(quote.data.fee, b.currency)}</b>
            </p>
            {quote.data.refund_due > 0 && (
              <p>להחזיר לאורח: {money(quote.data.refund_due, b.currency)}</p>
            )}
            {quote.data.charge_due > 0 && (
              <p>לגבות מהאורח: {money(quote.data.charge_due, b.currency)}</p>
            )}
          </>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
        דמי ביטול אחרים (הנחה או ויתור)
      </label>
      {override && (
        <>
          <div className={field}>
            <Label htmlFor="cn-fee">דמי ביטול</Label>
            <Input
              id="cn-fee"
              type="number"
              inputMode="decimal"
              min={0}
              dir="ltr"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="min-h-11"
            />
          </div>
          <div className={field}>
            <Label htmlFor="cn-why">למה (נשמר בהיסטוריה)</Label>
            <Input
              id="cn-why"
              value={overrideReason}
              maxLength={1000}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="min-h-11"
            />
          </div>
        </>
      )}
      <div className={field}>
        <Label htmlFor="cn-reason">סיבת הביטול (לא חובה — תופיע במייל לאורח)</Label>
        <Input
          id="cn-reason"
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11"
        />
      </div>
      {invalid && <p className="text-sm text-destructive">{invalid}</p>}
    </FormSheet>
  );
}

function CancellationRequest({
  b,
  onError,
}: {
  b: BookingDetail;
  onError: (m: string | null) => void;
}) {
  const refresh = useBookingRefresh(b.id);
  const outcome = (b.cancellation_outcome ?? {}) as {
    fee?: number;
    refund_due?: number;
    charge_due?: number;
  };
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);
  return (
    <Card className="border-amber-500" data-section="cancellation-request">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2>האורח ביקש לבטל</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>
          הבקשה התקבלה ב-{dateTimeText(b.cancellation_requested_at)}
          {b.cancellation_reason ? ` — "${b.cancellation_reason}"` : ""}.
        </p>
        {outcome.fee !== undefined && (
          <p>
            לפי המדיניות: דמי ביטול <b>{money(outcome.fee, b.currency)}</b>
            {outcome.refund_due ? ` · להחזיר ${money(outcome.refund_due, b.currency)}` : ""}
            {outcome.charge_due ? ` · לגבות ${money(outcome.charge_due, b.currency)}` : ""}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" onClick={() => setMode("approve")}>
            אישור הביטול
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setMode("decline")}
          >
            דחיית הבקשה
          </Button>
        </div>
      </CardContent>
      {mode && (
        <DecisionSheet
          b={b}
          mode={mode}
          fee={outcome.fee ?? 0}
          onClose={() => setMode(null)}
          onDone={() => {
            onError(null);
            refresh();
          }}
        />
      )}
    </Card>
  );
}

function DecisionSheet(props: {
  b: BookingDetail;
  mode: "approve" | "decline";
  fee: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { b, mode } = props;
  const [override, setOverride] = useState(false);
  const [fee, setFee] = useState(String(props.fee));
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid =
    mode === "decline"
      ? why.trim()
        ? null
        : "יש לכתוב לאורח למה הבקשה לא אושרה"
      : override && (fee === "" || !why.trim())
        ? "יש לכתוב סכום וסיבה"
        : null;
  return (
    <FormSheet
      open
      title={mode === "approve" ? "אישור בקשת הביטול" : "דחיית בקשת הביטול"}
      description={
        mode === "approve"
          ? "ההזמנה תבוטל והתאריכים יתפנו. האורח יקבל מייל עם דמי הביטול."
          : "ההזמנה נשארת בתוקף. האורח יקבל מייל עם ההסבר."
      }
      dirty
      busy={busy}
      submitLabel={mode === "approve" ? "אישור הביטול" : "דחיית הבקשה"}
      serverError={error}
      notice={null}
      hasErrors={Boolean(invalid)}
      submitted
      onClose={props.onClose}
      onSubmit={() => {
        if (invalid) return;
        setBusy(true);
        setError(null);
        const call =
          mode === "approve"
            ? hospitalityApproveCancellation({
                data: {
                  id: b.id,
                  revision: b.revision,
                  feeOverride: override ? fee : null,
                  overrideReason: override ? why : null,
                },
              })
            : hospitalityDeclineCancellation({
                data: { id: b.id, revision: b.revision, reason: why },
              });
        void call
          .then(() => {
            toast.success(mode === "approve" ? "הביטול אושר" : "בקשת הביטול נדחתה");
            props.onDone();
            props.onClose();
          })
          .catch((e: unknown) => {
            setError(errorText(e));
            props.onDone();
          })
          .finally(() => setBusy(false));
      }}
    >
      {mode === "approve" && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
            להפחית או לוותר על דמי הביטול
          </label>
          {override && (
            <div className={field}>
              <Label htmlFor="dc-fee">דמי ביטול</Label>
              <Input
                id="dc-fee"
                type="number"
                inputMode="decimal"
                min={0}
                dir="ltr"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="min-h-11"
              />
            </div>
          )}
        </>
      )}
      {(mode === "decline" || override) && (
        <div className={field}>
          <Label htmlFor="dc-why">
            {mode === "decline" ? "הסבר לאורח" : "למה (נשמר בהיסטוריה)"}
          </Label>
          <Input
            id="dc-why"
            value={why}
            maxLength={1000}
            onChange={(e) => setWhy(e.target.value)}
            className="min-h-11"
          />
        </div>
      )}
      {invalid && <p className="text-sm text-destructive">{invalid}</p>}
    </FormSheet>
  );
}
