// "הוספת הזמנה" (/manage/bookings/new) — Stage 2i: הזמנה טלפונית / מהמקום / מערוץ אחר.
// יחידה, תאריכים, אורחים; המחיר מחושב בשרת (תצוגה לפני השמירה) או מחיר ידני; מאושרת מיד
// או כבקשה; מדיניות ביטול (ברירת המחדל או אחרת) ואישור שהוסברה לאורח; מייל לאורח (רשות).
// מניעת הזמנה כפולה — במסד. נפתח גם מהיומן עם יחידה ותאריכים (?unit=&from=&to=, Stage 3b).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, Checkbox, Input, Label, cn } from "@/platform/ui";
import { hospitalityCreateBooking } from "../../api/bookings.functions";
import { hospitalityPriceQuote, hospitalityPricing } from "../../api/pricing.functions";
import type { PriceQuote } from "../../types/pricing";
import { createBookingError } from "../../validation/bookings";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { money, policySummary } from "../pricing/model";
import { useManagement } from "../shell/management-context";
import { useBookingRefresh } from "./refresh";
import { dayText } from "./model";

const field = "flex flex-col gap-1.5";
const select = "min-h-11 rounded-md border border-input bg-background px-3";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function NewBookingPage() {
  const ctx = useManagement();
  const pricing = useQuery({
    queryKey: [...manageKeys.all, "pricing"],
    queryFn: () => hospitalityPricing(),
    refetchOnWindowFocus: false,
  });
  if (!ctx.permissions["bookings"])
    return <p className="p-4">אין לכם הרשאה להוסיף הזמנות באתר הזה.</p>;
  if (pricing.isError && !pricing.data) return <LoadError error={pricing.error} />;
  if (!pricing.data) return <PageSkeleton label="טוען…" />;
  return <Form view={pricing.data} />;
}

function Form({ view }: { view: Awaited<ReturnType<typeof hospitalityPricing>> }) {
  const navigate = useNavigate();
  const refresh = useBookingRefresh(null);
  const search = useSearch({ strict: false }) as { unit?: string; from?: string; to?: string };
  const units = view.units.filter((u) => u.is_active);
  const defaultPolicy = view.policies.find((p) => p.is_default);
  const [f, setF] = useState({
    unitId: units.some((u) => u.id === search.unit) ? search.unit! : (units[0]?.id ?? ""),
    checkIn: search.from && DATE.test(search.from) ? search.from : "",
    checkOut: search.to && DATE.test(search.to) ? search.to : "",
    adults: 2,
    children: 0,
    fullName: "",
    phone: "",
    email: "",
    status: "confirmed" as "confirmed" | "pending_approval",
    source: "phone" as "phone" | "walk_in" | "owner" | "external",
    channel: "",
    policyId: "",
    manual: false,
    total: "",
    notes: "",
    termsExplained: false,
    sendGuestEmail: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // תצוגת המחיר מהשרת — בכל שינוי של יחידה / תאריכים / אורחים
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!f.unitId || !DATE.test(f.checkIn) || !DATE.test(f.checkOut) || f.checkOut <= f.checkIn)
      return;
    let live = true;
    const t = setTimeout(() => {
      hospitalityPriceQuote({
        data: {
          unitId: f.unitId,
          checkIn: f.checkIn,
          checkOut: f.checkOut,
          adults: f.adults,
          children: f.children,
        },
      })
        .then((q) => live && setQuote(q))
        .catch((e: unknown) => live && setQuoteError(errorText(e)));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [f.unitId, f.checkIn, f.checkOut, f.adults, f.children]);

  const error =
    createBookingError(f) ?? (f.manual && f.total === "" ? "יש להזין את המחיר הידני" : null);
  const policy = view.policies.find((p) => p.id === (f.policyId || defaultPolicy?.id));
  const unit = units.find((u) => u.id === f.unitId);

  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await hospitalityCreateBooking({
        data: {
          ...f,
          email: f.email || null,
          channel: f.channel || null,
          notes: f.notes || null,
          policyId: f.policyId || null,
          totalOverride: f.manual ? f.total : null,
        },
      });
      toast.success(`הזמנה #${r.number} נשמרה`);
      refresh();
      void navigate({ to: "/manage/bookings/$bookingId", params: { bookingId: r.booking_id } });
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (units.length === 0)
    return (
      <div className="mx-auto max-w-2xl p-4">
        <p>
          עדיין אין יחידה פעילה.{" "}
          <Link to="/manage/units" className="font-medium text-primary hover:underline">
            להוספת יחידה
          </Link>
        </p>
      </div>
    );

  return (
    <form
      className="mx-auto flex max-w-2xl flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      <Link
        to="/manage/bookings"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
        חזרה להזמנות
      </Link>
      <h1 className="text-2xl font-semibold">הוספת הזמנה</h1>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h2 className="font-semibold">השהייה</h2>
          <div className={field}>
            <Label htmlFor="nb-unit">יחידה</Label>
            <select
              id="nb-unit"
              className={select}
              value={f.unitId}
              onChange={(e) => set("unitId", e.target.value)}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {view.properties.length > 1 ? ` · ${u.property_name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={field}>
              <Label htmlFor="nb-in">הגעה</Label>
              <Input
                id="nb-in"
                type="date"
                dir="ltr"
                value={f.checkIn}
                onChange={(e) => set("checkIn", e.target.value)}
                className="min-h-11"
              />
            </div>
            <div className={field}>
              <Label htmlFor="nb-out">עזיבה</Label>
              <Input
                id="nb-out"
                type="date"
                dir="ltr"
                value={f.checkOut}
                onChange={(e) => set("checkOut", e.target.value)}
                className="min-h-11"
              />
            </div>
            <div className={field}>
              <Label htmlFor="nb-adults">מבוגרים</Label>
              <Input
                id="nb-adults"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={f.adults}
                onChange={(e) => set("adults", Math.max(1, Number(e.target.value) || 1))}
                className="min-h-11"
              />
            </div>
            <div className={field}>
              <Label htmlFor="nb-children">ילדים</Label>
              <Input
                id="nb-children"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={f.children}
                onChange={(e) => set("children", Math.max(0, Number(e.target.value) || 0))}
                className="min-h-11"
              />
            </div>
          </div>
          {unit && (
            <p className="text-xs text-muted-foreground">עד {unit.capacity} אורחים ביחידה.</p>
          )}
          <QuoteBox quote={quote} error={quoteError} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h2 className="font-semibold">האורח</h2>
          <div className={field}>
            <Label htmlFor="nb-name">שם מלא</Label>
            <Input
              id="nb-name"
              value={f.fullName}
              maxLength={120}
              onChange={(e) => set("fullName", e.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="nb-phone">טלפון</Label>
              <Input
                id="nb-phone"
                type="tel"
                dir="ltr"
                value={f.phone}
                maxLength={30}
                onChange={(e) => set("phone", e.target.value)}
                className="min-h-11"
              />
            </div>
            <div className={field}>
              <Label htmlFor="nb-email">אימייל (לא חובה)</Label>
              <Input
                id="nb-email"
                type="email"
                dir="ltr"
                value={f.email}
                onChange={(e) => set("email", e.target.value)}
                className="min-h-11"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            אורח שכבר הזמין (אותו טלפון או אימייל) — מזוהה אוטומטית.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <h2 className="font-semibold">ההזמנה</h2>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">מצב</legend>
            {(
              [
                ["confirmed", "מאושרת — התאריכים נשמרים מיד"],
                ["pending_approval", "בקשה — לאשר מאוחר יותר"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="nb-status"
                  className="size-4 accent-primary"
                  checked={f.status === v}
                  onChange={() => set("status", v)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="nb-source">מקור</Label>
              <select
                id="nb-source"
                className={select}
                value={f.source}
                onChange={(e) => set("source", e.target.value as typeof f.source)}
              >
                <option value="phone">טלפון</option>
                <option value="walk_in">הגיעו למקום</option>
                <option value="owner">הבעלים</option>
                <option value="external">ערוץ חיצוני</option>
              </select>
            </div>
            <div className={field}>
              <Label htmlFor="nb-channel">ערוץ (לא חובה)</Label>
              <Input
                id="nb-channel"
                value={f.channel}
                maxLength={60}
                placeholder="למשל: Booking.com, חבר"
                onChange={(e) => set("channel", e.target.value)}
                className="min-h-11"
              />
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={f.manual} onCheckedChange={(v) => set("manual", v === true)} />
            מחיר ידני (במקום המחיר המחושב)
          </label>
          {f.manual && (
            <div className={field}>
              <Label htmlFor="nb-total">סה״כ להזמנה</Label>
              <Input
                id="nb-total"
                type="number"
                inputMode="decimal"
                min={0}
                dir="ltr"
                value={f.total}
                onChange={(e) => set("total", e.target.value)}
                className="min-h-11"
              />
            </div>
          )}
          <div className={field}>
            <Label htmlFor="nb-policy">מדיניות ביטול</Label>
            <select
              id="nb-policy"
              className={select}
              value={f.policyId}
              onChange={(e) => set("policyId", e.target.value)}
            >
              <option value="">ברירת המחדל{defaultPolicy ? ` (${defaultPolicy.name})` : ""}</option>
              {view.policies
                .filter((p) => !p.is_default)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            {policy && (
              <p className="text-xs text-muted-foreground">{policySummary(policy.rules)}</p>
            )}
          </div>
          <div className={field}>
            <Label htmlFor="nb-notes">הערה פנימית (לא חובה)</Label>
            <Input
              id="nb-notes"
              value={f.notes}
              maxLength={4000}
              onChange={(e) => set("notes", e.target.value)}
              className="min-h-11"
            />
          </div>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <Checkbox
              className="mt-1"
              checked={f.termsExplained}
              onCheckedChange={(v) => set("termsExplained", v === true)}
            />
            הסברתי לאורח את תנאי הביטול
          </label>
          <label
            className={cn(
              "flex min-h-11 items-center gap-2 text-sm",
              !f.email && "text-muted-foreground",
            )}
          >
            <Checkbox
              disabled={!f.email}
              checked={f.sendGuestEmail && Boolean(f.email)}
              onCheckedChange={(v) => set("sendGuestEmail", v === true)}
            />
            לשלוח לאורח מייל עם פרטי ההזמנה
          </label>
        </CardContent>
      </Card>

      {submitted && error && <p className="text-sm text-destructive">{error}</p>}
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      <Button type="submit" className="min-h-11" disabled={busy}>
        {busy ? "שומרים…" : "שמירת ההזמנה"}
      </Button>
    </form>
  );
}

function QuoteBox({ quote, error }: { quote: PriceQuote | null; error: string | null }) {
  if (error) return <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{error}</p>;
  if (!quote) return null;
  return (
    <div className="rounded-md bg-muted p-3 text-sm" data-testid="new-booking-quote">
      <p className="font-medium">
        {quote.nights_count === 1 ? "לילה אחד" : `${quote.nights_count} לילות`} · סה״כ{" "}
        {money(quote.total, quote.currency)}
      </p>
      <p className="text-muted-foreground">
        {dayText(quote.check_in)} – {dayText(quote.check_out)}
      </p>
      {!quote.available && (
        <p className="mt-1 font-medium text-destructive">היחידה תפוסה או חסומה בחלק מהתאריכים.</p>
      )}
      {quote.nights_count < quote.min_nights && (
        <p className="mt-1 text-amber-900">מינימום הלילות בתאריכים האלה: {quote.min_nights}.</p>
      )}
    </div>
  );
}
