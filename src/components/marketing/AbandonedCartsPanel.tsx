import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BellRing,
  CheckCircle2,
  Clock,
  Gift,
  Loader2,
  Mail,
  MailCheck,
  MousePointerClick,
  Package,
  Phone,
  RefreshCw,
  Send,
  ShoppingCart,
  Trash2,
  X,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_REMINDER_MESSAGE, sendCartReminder } from "@/lib/marketing.functions";
import { COUPON_COLUMNS, couponLabel, couponStatus, type Coupon } from "@/lib/coupons";
import { formatIls } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type CartStatus = "open" | "recovered" | "dismissed";

type CartLine = {
  product_id: string;
  name: string;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  image_url: string | null;
};

type AbandonedCart = {
  id: string;
  email: string;
  customer_name: string | null;
  phone: string | null;
  items: CartLine[];
  item_count: number;
  total: number;
  status: CartStatus;
  reminder_count: number;
  last_reminder_at: string | null;
  last_reminder_coupon: string | null;
  restored_at: string | null;
  created_at: string;
  updated_at: string;
};

const CART_COLUMNS =
  "id, email, customer_name, phone, items, item_count, total, status, reminder_count, last_reminder_at, last_reminder_coupon, restored_at, created_at, updated_at";

const FILTERS: { value: CartStatus; label: string }[] = [
  { value: "open", label: "לא הושלמו" },
  { value: "recovered", label: "הושלמו" },
  { value: "dismissed", label: "סגורות" },
];

/** הלקוח עוד בקופה (עדכון בחצי השעה האחרונה) — לא "נטושה" עדיין */
const ACTIVE_MS = 30 * 60 * 1000;

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

/**
 * עגלות נטושות (חלק 14): לקוחות שהגיעו לקופה, הזינו אימייל ולא השלימו
 * הזמנה. "שלח תזכורת" שולח מייל (Resend) עם הסל וקישור שמשחזר אותו בקופה —
 * ואפשר לצרף קופון. עגלה שהלקוח השלים ממנה הזמנה עוברת לבד ל"הושלמו".
 */
export function AbandonedCartsPanel() {
  const [filter, setFilter] = useState<CartStatus>("open");
  const [carts, setCarts] = useState<AbandonedCart[] | null>(null);
  const [counts, setCounts] = useState<Record<CartStatus, number>>({
    open: 0,
    recovered: 0,
    dismissed: 0,
  });
  const [openValue, setOpenValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reminding, setReminding] = useState<AbandonedCart | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: summary }] = await Promise.all([
      supabase
        .from("abandoned_carts")
        .select(CART_COLUMNS)
        .eq("status", filter)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase.from("abandoned_carts").select("status, total").limit(5000),
    ]);
    if (error) toast.error(error.message);
    setCarts(
      ((data ?? []) as unknown as AbandonedCart[]).map((cart) => ({
        ...cart,
        total: Number(cart.total),
        items: Array.isArray(cart.items) ? cart.items : [],
      })),
    );
    const next: Record<CartStatus, number> = { open: 0, recovered: 0, dismissed: 0 };
    let value = 0;
    for (const row of summary ?? []) {
      next[row.status as CartStatus] += 1;
      if (row.status === "open") value += Number(row.total);
    }
    setCounts(next);
    setOpenValue(value);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setCarts(null);
    void load();
  }, [load]);

  const setStatus = async (cart: AbandonedCart, status: CartStatus) => {
    const { error } = await supabase
      .from("abandoned_carts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", cart.id);
    if (error) toast.error(error.message);
    else toast.success(status === "dismissed" ? "העגלה נסגרה" : "העגלה הוחזרה לרשימה");
    void load();
  };

  const remove = async (cart: AbandonedCart) => {
    const { error } = await supabase.from("abandoned_carts").delete().eq("id", cart.id);
    if (error) toast.error(error.message);
    else toast.success("העגלה נמחקה");
    void load();
  };

  const decided = counts.recovered + counts.dismissed + counts.open;
  const recoveryRate = decided > 0 ? Math.round((counts.recovered / decided) * 100) : 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <ShoppingCart className="size-6 text-accent" aria-hidden="true" />
            עגלות נטושות
          </h2>
          <p className="text-sm text-muted-foreground">
            לקוחות שהזינו אימייל בקופה ולא השלימו את ההזמנה. תזכורת עם קישור שממלא את הסל מחדש —
            ועם קופון, אם תרצו — מחזירה חלק נכבד מהם.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          רענון
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ממתינות לתזכורת</p>
            <p className="text-2xl font-black">{counts.open.toLocaleString("he-IL")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">שווי העגלות הפתוחות</p>
            <p className="text-2xl font-black">{formatIls(openValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">הושלמו להזמנה</p>
            <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
              {counts.recovered.toLocaleString("he-IL")}
              <span className="text-sm font-medium text-muted-foreground"> · {recoveryRate}%</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="סינון עגלות">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filter === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {option.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs font-bold",
                filter === option.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}
            >
              {counts[option.value]}
            </span>
          </button>
        ))}
      </div>

      {carts === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : carts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="size-9 text-emerald-600" aria-hidden="true" />
            <p className="font-semibold">
              {filter === "open" ? "אין עגלות נטושות כרגע 🎉" : "אין עגלות להצגה"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              עגלה נשמרת ברגע שלקוח מזין אימייל בקופה, ונסגרת לבד כשהוא משלים את ההזמנה.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {carts.map((cart) => {
            const active = cart.status === "open" && Date.now() - Date.parse(cart.updated_at) < ACTIVE_MS;
            return (
              <Card key={cart.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {cart.customer_name || "לקוח"}
                        {active && (
                          <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                            עדיין בקופה
                          </Badge>
                        )}
                        {cart.status === "recovered" && (
                          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                            הזמין
                          </Badge>
                        )}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Mail className="size-3.5" aria-hidden="true" />
                          {cart.email}
                        </span>
                        {cart.phone && (
                          <a href={`tel:${cart.phone}`} className="inline-flex items-center gap-1 hover:underline" dir="ltr">
                            <Phone className="size-3.5" aria-hidden="true" />
                            {cart.phone}
                          </a>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden="true" />
                          {timeAgo(cart.updated_at)}
                        </span>
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-xl font-black">{formatIls(cart.total)}</p>
                      <p className="text-xs text-muted-foreground">
                        {cart.item_count.toLocaleString("he-IL")} פריטים
                      </p>
                    </div>
                  </div>

                  <ul className="flex flex-wrap gap-2">
                    {cart.items.slice(0, 6).map((item, index) => (
                      <li
                        key={`${item.product_id}-${index}`}
                        className="flex max-w-[16rem] items-center gap-2 rounded-lg border bg-secondary/30 py-1 pe-2.5 ps-1"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-card">
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="size-full object-contain" />
                          ) : (
                            <Package className="size-4 text-muted-foreground" aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0 text-xs">
                          <span className="block truncate font-medium">{item.name}</span>
                          <span className="text-muted-foreground">
                            {item.variant_label ? `${item.variant_label} · ` : ""}× {item.quantity}
                          </span>
                        </span>
                      </li>
                    ))}
                    {cart.items.length > 6 && (
                      <li className="self-center text-xs text-muted-foreground">
                        ועוד {cart.items.length - 6}…
                      </li>
                    )}
                  </ul>

                  {(cart.reminder_count > 0 || cart.restored_at) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {cart.reminder_count > 0 && cart.last_reminder_at && (
                        <span className="inline-flex items-center gap-1">
                          <MailCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
                          {cart.reminder_count === 1 ? "נשלחה תזכורת" : `נשלחו ${cart.reminder_count} תזכורות`}{" "}
                          (אחרונה {timeAgo(cart.last_reminder_at)}
                          {cart.last_reminder_coupon ? ` · קופון ${cart.last_reminder_coupon}` : ""})
                        </span>
                      )}
                      {cart.restored_at && (
                        <span className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400">
                          <MousePointerClick className="size-3.5" aria-hidden="true" />
                          הלקוח פתח את הקישור {timeAgo(cart.restored_at)}
                        </span>
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                    {cart.status === "open" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setStatus(cart, "dismissed")}
                        >
                          <X className="size-4" />
                          סגירה
                        </Button>
                        <Button size="sm" onClick={() => setReminding(cart)}>
                          <BellRing className="size-4" />
                          שלח תזכורת
                        </Button>
                      </>
                    )}
                    {cart.status === "dismissed" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void remove(cart)}
                        >
                          <Trash2 className="size-4" />
                          מחיקה
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void setStatus(cart, "open")}>
                          החזרה לרשימה
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReminderDialog
        cart={reminding}
        onClose={() => setReminding(null)}
        onSent={() => {
          setReminding(null);
          void load();
        }}
      />
    </section>
  );
}

const NO_COUPON = "__none__";

function ReminderDialog({
  cart,
  onClose,
  onSent,
}: {
  cart: AbandonedCart | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const send = useServerFn(sendCartReminder);
  const [message, setMessage] = useState(DEFAULT_REMINDER_MESSAGE);
  const [coupon, setCoupon] = useState(NO_COUPON);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cart) return;
    setMessage(DEFAULT_REMINDER_MESSAGE);
    setCoupon(NO_COUPON);
    void (async () => {
      const { data } = await supabase
        .from("coupons")
        .select(COUPON_COLUMNS)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      setCoupons(
        ((data ?? []) as Coupon[])
          .map((c) => ({ ...c, discount_value: Number(c.discount_value) }))
          .filter((c) => couponStatus(c, 0) === "active" || couponStatus(c, 0) === "used_up"),
      );
    })();
  }, [cart]);

  const chosen = useMemo(() => coupons.find((c) => c.code === coupon) ?? null, [coupons, coupon]);

  const submit = async () => {
    if (!cart) return;
    setBusy(true);
    try {
      const result = await send({
        data: { cartId: cart.id, message, couponCode: coupon === NO_COUPON ? null : coupon },
      });
      toast.success(`התזכורת נשלחה ל-${result.to}`);
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת התזכורת נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={cart !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-lg">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="size-5 text-accent" aria-hidden="true" />
            תזכורת על עגלה נטושה
          </DialogTitle>
          <DialogDescription>
            יישלח ל-<span dir="ltr">{cart?.email}</span> — עם המוצרים שבסל וכפתור "להשלמת ההזמנה"
            שממלא את הסל מחדש בקופה.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rem-message">נוסח ההודעה</Label>
            <Textarea
              id="rem-message"
              rows={5}
              maxLength={1500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Gift className="size-4 text-accent" aria-hidden="true" />
              צירוף קופון (לא חובה)
            </Label>
            <Select value={coupon} onValueChange={setCoupon} dir="rtl">
              <SelectTrigger>
                <SelectValue placeholder="בלי קופון" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COUPON}>בלי קופון</SelectItem>
                {coupons.map((c) => (
                  <SelectItem key={c.id} value={c.code}>
                    {c.code} — {couponLabel(c.discount_type, c.discount_value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {coupons.length === 0 && (
              <p className="text-xs text-muted-foreground">
                אין קופונים פעילים — אפשר ליצור אחד בלשונית "קופונים".
              </p>
            )}
            {chosen && (
              <p className="rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                🎁 הלקוח יקבל את הקוד <strong dir="ltr">{chosen.code}</strong> (
                {couponLabel(chosen.discount_type, chosen.discount_value)}), והוא יופעל לבד בקופה
                כשילחץ על הקישור.
              </p>
            )}
          </div>

          {cart && (
            <div className="rounded-xl bg-secondary/50 p-3 text-sm">
              <p className="font-semibold">בסל: {cart.items.length} מוצרים · {formatIls(cart.total)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {cart.items.map((item) => item.name).join(" · ")}
              </p>
            </div>
          )}

          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={busy || message.trim().length < 2}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 -scale-x-100" />}
            שליחת התזכורת
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
