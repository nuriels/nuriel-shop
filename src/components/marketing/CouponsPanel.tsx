import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Copy,
  Loader2,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Shuffle,
  TicketPercent,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  COUPON_COLUMNS,
  COUPON_STATUS_LABELS,
  couponCodeProblem,
  couponLabel,
  couponStatus,
  normalizeCouponCode,
  type Coupon,
  type CouponStatus,
  type CouponType,
} from "@/lib/coupons";
import { formatIls } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Usage = { uses: number; total: number };

const STATUS_STYLE: Record<CouponStatus, string> = {
  active:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  inactive: "border-border bg-muted text-muted-foreground",
  scheduled:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  expired:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  used_up:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });

/** "2026-10-04T12:00" (שעון ישראל במחשב של המנהל) ↔ ISO */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `SALE-${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}

/**
 * קופונים וקודי הנחה (חלק 14): יצירה, עריכה, הפעלה / כיבוי ומחיקה.
 * הלקוח מקליד את הקוד בקופה — ההנחה (אחוז או סכום קבוע מסכום המוצרים)
 * נבדקת ונקבעת במסד בזמן שליחת ההזמנה.
 */
export function CouponsPanel() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [usage, setUsage] = useState<Map<string, Usage>>(new Map());
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: usageRows }] = await Promise.all([
      supabase.from("coupons").select(COUPON_COLUMNS).order("created_at", { ascending: false }),
      supabase.rpc("coupon_usage"),
    ]);
    if (error) toast.error(error.message);
    setCoupons(
      ((data ?? []) as Coupon[]).map((c) => ({
        ...c,
        discount_value: Number(c.discount_value),
        min_order_total: c.min_order_total == null ? null : Number(c.min_order_total),
      })),
    );
    setUsage(
      new Map(
        (usageRows ?? []).map((row) => [
          row.coupon_id,
          { uses: Number(row.uses), total: Number(row.discount_total) },
        ]),
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (coupon: Coupon, next: boolean) => {
    setCoupons(
      (list) => list?.map((c) => (c.id === coupon.id ? { ...c, is_active: next } : c)) ?? list,
    );
    const { error } = await supabase
      .from("coupons")
      .update({ is_active: next })
      .eq("id", coupon.id);
    if (error) {
      toast.error(error.message);
      void load();
    } else {
      toast.success(next ? `הקופון ${coupon.code} הופעל` : `הקופון ${coupon.code} כובה`);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("coupons").delete().eq("id", deleting.id);
    if (error) toast.error(error.message);
    else toast.success("הקופון נמחק");
    setDeleting(null);
    void load();
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`הקוד ${code} הועתק`);
    } catch {
      toast.info(code);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <TicketPercent className="size-6 text-accent" aria-hidden="true" />
            קופונים וקודי הנחה
          </h2>
          <p className="text-sm text-muted-foreground">
            קוד שהלקוח מקליד בקופה ומקבל הנחה — באחוזים או בסכום קבוע, מסכום המוצרים (לפני משלוח).
            אפשר להציג קוד בפופ-אפ המבצעים ולצרף לתזכורת על עגלה נטושה.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            רענון
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            קופון חדש
          </Button>
        </div>
      </div>

      {coupons === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : coupons.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-secondary">
              <Percent className="size-7 text-primary" aria-hidden="true" />
            </span>
            <p className="text-lg font-semibold">עוד אין קופונים</p>
            <p className="max-w-md text-sm text-muted-foreground">
              צרו קוד ראשון — למשל WELCOME10 ל-10% הנחה ללקוחות חדשים, או SHIP20 ל-20 ₪ הנחה.
            </p>
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              יצירת קופון
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {coupons.map((coupon) => {
            const used = usage.get(coupon.id) ?? { uses: 0, total: 0 };
            const status = couponStatus(coupon, used.uses);
            return (
              <Card
                key={coupon.id}
                className={cn("overflow-hidden", !coupon.is_active && "opacity-75")}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void copy(coupon.code)}
                        className="group inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-accent/60 bg-accent/10 px-3 py-1 font-mono text-lg font-black tracking-wider hover:bg-accent/20"
                        dir="ltr"
                        title="העתקת הקוד"
                      >
                        {coupon.code}
                        <Copy
                          className="size-3.5 opacity-50 group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </button>
                      <p className="mt-1.5 text-base font-bold">
                        {couponLabel(coupon.discount_type, coupon.discount_value)}
                      </p>
                      {coupon.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {coupon.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant="outline" className={STATUS_STYLE[status]}>
                        {COUPON_STATUS_LABELS[status]}
                      </Badge>
                      <Switch
                        checked={coupon.is_active}
                        onCheckedChange={(next) => void toggle(coupon, next)}
                        aria-label={coupon.is_active ? "כיבוי הקופון" : "הפעלת הקופון"}
                      />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">שימושים</dt>
                    <dd className="font-semibold">
                      {used.uses.toLocaleString("he-IL")}
                      {coupon.max_uses !== null
                        ? ` / ${coupon.max_uses.toLocaleString("he-IL")}`
                        : ""}
                      {used.total > 0 && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {formatIls(used.total)} הנחה
                        </span>
                      )}
                    </dd>
                    {coupon.min_order_total !== null && (
                      <>
                        <dt className="text-muted-foreground">מינימום הזמנה</dt>
                        <dd className="font-semibold">{formatIls(coupon.min_order_total)}</dd>
                      </>
                    )}
                    {(coupon.starts_at || coupon.expires_at) && (
                      <>
                        <dt className="flex items-center gap-1 text-muted-foreground">
                          <CalendarClock className="size-3" aria-hidden="true" />
                          בתוקף
                        </dt>
                        <dd className="font-semibold">
                          {coupon.starts_at ? `מ-${shortDate(coupon.starts_at)}` : ""}
                          {coupon.starts_at && coupon.expires_at ? " " : ""}
                          {coupon.expires_at ? `עד ${shortDate(coupon.expires_at)}` : ""}
                        </dd>
                      </>
                    )}
                  </dl>
                  <div className="flex justify-end gap-1 border-t pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(coupon)}>
                      <Pencil className="size-4" />
                      עריכה
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(coupon)}
                    >
                      <Trash2 className="size-4" />
                      מחיקה
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CouponDialog
        coupon={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הקופון {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (usage.get(deleting.id)?.uses ?? 0) > 0
                ? "הקופון כבר שימש בהזמנות — ההנחה בהזמנות האלה נשמרת. כדי רק להפסיק את השימוש בו אפשר גם לכבות אותו."
                : "הקוד יפסיק לעבוד בקופה מיד."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              <Trash2 className="size-4" />
              כן, למחוק
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type CouponForm = {
  code: string;
  type: CouponType;
  value: string;
  description: string;
  minOrder: string;
  maxUses: string;
  startsAt: string;
  expiresAt: string;
  active: boolean;
};

function formOf(coupon: Coupon | null): CouponForm {
  return coupon
    ? {
        code: coupon.code,
        type: coupon.discount_type,
        value: String(coupon.discount_value),
        description: coupon.description ?? "",
        minOrder: coupon.min_order_total !== null ? String(coupon.min_order_total) : "",
        maxUses: coupon.max_uses !== null ? String(coupon.max_uses) : "",
        startsAt: toLocalInput(coupon.starts_at),
        expiresAt: toLocalInput(coupon.expires_at),
        active: coupon.is_active,
      }
    : {
        code: "",
        type: "percent",
        value: "10",
        description: "",
        minOrder: "",
        maxUses: "",
        startsAt: "",
        expiresAt: "",
        active: true,
      };
}

function CouponDialog({
  coupon,
  open,
  onClose,
  onSaved,
}: {
  coupon: Coupon | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CouponForm>(() => formOf(coupon));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(formOf(coupon));
      setError(null);
    }
  }, [open, coupon]);

  const patch = (next: Partial<CouponForm>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeCouponCode(form.code);
    const codeProblem = couponCodeProblem(code);
    if (codeProblem) return setError(codeProblem);
    // חלק 24: משלוח חינם — בלי ערך הנחה (ההנחה = דמי המשלוח של ההזמנה)
    const value = form.type === "free_shipping" ? 0 : Number(form.value);
    if (form.type !== "free_shipping" && (!Number.isFinite(value) || value <= 0)) {
      return setError("ערך ההנחה חייב להיות גדול מ-0");
    }
    if (form.type === "percent" && value > 100) return setError("הנחה באחוזים: עד 100%");
    const minOrder = form.minOrder.trim() === "" ? null : Number(form.minOrder);
    if (minOrder !== null && (!Number.isFinite(minOrder) || minOrder <= 0)) {
      return setError("מינימום הזמנה: סכום חיובי, או ריק");
    }
    const maxUses = form.maxUses.trim() === "" ? null : Number(form.maxUses);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      return setError("מספר שימושים: מספר שלם חיובי, או ריק (ללא הגבלה)");
    }
    const startsAt = fromLocalInput(form.startsAt);
    const expiresAt = fromLocalInput(form.expiresAt);
    if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
      return setError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
    }

    setBusy(true);
    setError(null);
    const values = {
      code,
      discount_type: form.type,
      discount_value: Math.round(value * 100) / 100,
      description: form.description.trim() || null,
      min_order_total: minOrder,
      max_uses: maxUses,
      starts_at: startsAt,
      expires_at: expiresAt,
      is_active: form.active,
    };
    const { error: saveError } = coupon
      ? await supabase.from("coupons").update(values).eq("id", coupon.id)
      : await supabase.from("coupons").insert(values);
    setBusy(false);
    if (saveError) {
      setError(
        /coupons_code_key|duplicate/i.test(saveError.message)
          ? `כבר יש קופון עם הקוד ${code}`
          : saveError.message,
      );
      return;
    }
    toast.success(coupon ? "הקופון עודכן" : `הקופון ${code} נוצר`);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-lg">
        <DialogHeader className="text-right">
          <DialogTitle>{coupon ? `עריכת הקופון ${coupon.code}` : "קופון חדש"}</DialogTitle>
          <DialogDescription>
            הלקוח מקליד את הקוד בקופה. ההנחה חלה על סכום המוצרים (לא על המשלוח).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-code">קוד הקופון</Label>
            <div className="flex gap-2">
              <Input
                id="cp-code"
                dir="ltr"
                value={form.code}
                maxLength={32}
                autoFocus={!coupon}
                placeholder="WELCOME10"
                className="font-mono uppercase tracking-wider"
                onChange={(e) => patch({ code: e.target.value.toUpperCase().replace(/\s+/g, "") })}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => patch({ code: randomCode() })}
                title="קוד אקראי"
              >
                <Shuffle className="size-4" />
                אקראי
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              אותיות באנגלית, ספרות, מקף וקו תחתון. גדול / קטן — לא משנה ללקוח.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>סוג ההנחה</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {(
                [
                  ["percent", "אחוז מהסכום", "%"],
                  ["fixed", "סכום קבוע", "₪"],
                  ["free_shipping", "משלוח חינם", "🚚"],
                ] as const
              ).map(([value, label, sign]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.type === value}
                  onClick={() => patch({ type: value })}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition",
                    form.type === value
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  <span className="text-lg">{sign}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn("space-y-1.5", form.type === "free_shipping" && "hidden")}>
              <Label htmlFor="cp-value">
                {form.type === "percent" ? "אחוז הנחה" : "סכום הנחה (₪)"}
              </Label>
              <Input
                id="cp-value"
                inputMode="decimal"
                dir="ltr"
                value={form.value}
                onChange={(e) => patch({ value: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-min">מינימום הזמנה (₪, לא חובה)</Label>
              <Input
                id="cp-min"
                inputMode="decimal"
                dir="ltr"
                value={form.minOrder}
                placeholder="ללא"
                onChange={(e) => patch({ minOrder: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-desc">תיאור פנימי (לא חובה)</Label>
            <Input
              id="cp-desc"
              value={form.description}
              maxLength={160}
              placeholder="למשל: ללקוחות חדשים מהניוזלטר"
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-start">מתחיל ב- (לא חובה)</Label>
              <Input
                id="cp-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => patch({ startsAt: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-end">בתוקף עד (לא חובה)</Label>
              <Input
                id="cp-end"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => patch({ expiresAt: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-uses">כמה הזמנות יכולות להשתמש (לא חובה)</Label>
            <Input
              id="cp-uses"
              inputMode="numeric"
              dir="ltr"
              value={form.maxUses}
              placeholder="ללא הגבלה"
              onChange={(e) => patch({ maxUses: e.target.value })}
            />
          </div>

          <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <span className="text-sm font-medium">הקופון פעיל</span>
            <Switch checked={form.active} onCheckedChange={(v) => patch({ active: v })} />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {coupon ? "שמירת שינויים" : "יצירת הקופון"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
