import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrderRow } from "@/lib/orders";
import type { ProfileContact } from "@/lib/order-details";
import {
  assignCourier,
  loadCourierLinks,
  type CourierLinkInfo,
  type LabelStore,
} from "@/lib/delivery";
import {
  courierMessage,
  courierUrlFor,
  labelDataFromOrder,
  shareLabelToCourier,
  whatsappLink,
  type LabelData,
} from "@/lib/shipping-label";

type Row = {
  order: OrderRow;
  label: LabelData;
  token: string | null;
  link: CourierLinkInfo | null;
  attempts: number;
};

/**
 * מסירה לשליח (הזמנה אחת או כמה): שם וטלפון השליח (לא חובה), ואז קישור
 * אישי לכל הזמנה — בלי התחברות, בתוקף 7 ימים ומתחדש בכל מסירה. השליח
 * מסמן בקישור "נמסר" / "משלוח נכשל", ויכול לחזור אליו עד שנמסרה.
 * מכאן גם שולחים לשליח בוואטסאפ: טקסט + קישור, או תמונת מדבקה.
 */
export function CourierDialog({
  orders,
  open,
  onOpenChange,
  labelStore,
  profiles,
  onChanged,
}: {
  orders: OrderRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labelStore: LabelStore | null;
  profiles: Map<string, ProfileContact>;
  onChanged: () => void;
}) {
  const [courierName, setCourierName] = useState("");
  const [courierPhone, setCourierPhone] = useState("");
  const [links, setLinks] = useState<Map<string, CourierLinkInfo>>(new Map());
  const [tokens, setTokens] = useState<Map<string, { token: string; attempts: number }>>(new Map());
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const orderIds = useMemo(() => orders.map((order) => order.id), [orders]);
  const allWaiting = orders.length > 0 && orders.every((o) => o.status === "awaiting_courier");

  // קישורים קיימים — הזמנות שכבר ממתינות לשליח מוצגות מיד, בלי ליצור מחדש
  useEffect(() => {
    if (!open || orderIds.length === 0) return;
    let cancelled = false;
    setLoadingLinks(true);
    setTokens(new Map());
    loadCourierLinks(orderIds)
      .then((found) => {
        if (cancelled) return;
        setLinks(found);
        const first = [...found.values()][0];
        setCourierName(first?.courier_name ?? "");
        setCourierPhone(first?.courier_phone ?? "");
        const fresh = new Map<string, { token: string; attempts: number }>();
        for (const order of orders) {
          const link = found.get(order.id);
          if (
            order.status === "awaiting_courier" &&
            link &&
            new Date(link.expires_at).getTime() > Date.now()
          ) {
            fresh.set(order.id, { token: link.token, attempts: order.delivery_attempts ?? 0 });
          }
        }
        setTokens(fresh);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "טעינת הקישורים נכשלה"),
      )
      .finally(() => !cancelled && setLoadingLinks(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- נטען מחדש רק כשהבחירה משתנה
  }, [open, orderIds.join(",")]);

  const store = labelStore ?? { name: "", phone: null, size: { width: 70, height: 50 } };
  const rows: Row[] = orders.map((order) => {
    const issued = tokens.get(order.id);
    return {
      order,
      label: labelDataFromOrder(
        { ...order, delivery_attempts: issued?.attempts ?? order.delivery_attempts ?? 0 },
        order.customer_id ? (profiles.get(order.customer_id) ?? null) : null,
        { name: store.name, phone: store.phone },
      ),
      token: issued?.token ?? null,
      link: links.get(order.id) ?? null,
      attempts: issued?.attempts ?? order.delivery_attempts ?? 0,
    };
  });
  const ready = rows.length > 0 && rows.every((row) => row.token);

  const submit = async (renew = false) => {
    setSaving(true);
    try {
      const result = await assignCourier(orderIds, {
        name: courierName,
        phone: courierPhone,
        renew,
      });
      setTokens(
        new Map(result.map((r) => [r.order_id, { token: r.token, attempts: r.delivery_attempts }])),
      );
      setLinks(await loadCourierLinks(orderIds));
      toast.success(
        renew
          ? "נוצר קישור חדש — הקישור הקודם כבר לא עובד"
          : orders.length === 1
            ? `${orders[0]?.order_number} נמסרה לשליח`
            : `${orders.length} הזמנות נמסרו לשליח`,
      );
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "המסירה לשליח נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (row: Row) => {
    if (!row.token) return;
    try {
      await navigator.clipboard.writeText(courierUrlFor(row.token));
      setCopied(row.order.id);
      setTimeout(() => setCopied((current) => (current === row.order.id ? null : current)), 1800);
    } catch {
      toast.error("ההעתקה נכשלה — אפשר לסמן את הקישור ולהעתיק ידנית");
    }
  };

  const shareLabel = async (row: Row) => {
    if (!row.token) return;
    setSharing(row.order.id);
    try {
      const how = await shareLabelToCourier(
        row.label,
        store.size,
        courierUrlFor(row.token),
        courierPhone || row.link?.courier_phone,
      );
      if (how === "whatsapp") toast.success("תמונת המדבקה ירדה — צרפו אותה להודעה שנפתחה בוואטסאפ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השיתוף נכשל");
    } finally {
      setSharing(null);
    }
  };

  const whatsappAll = () => {
    const text = rows
      .filter((row) => row.token)
      .map((row) => courierMessage(row.label, courierUrlFor(row.token as string)))
      .join("\n\n— — —\n\n");
    window.open(whatsappLink(text, courierPhone), "_blank", "noopener");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Bike className="size-5 text-accent" aria-hidden="true" />
            {orders.length === 1
              ? `מסירה לשליח · ${orders[0]?.order_number}`
              : `מסירה לשליח · ${orders.length} הזמנות`}
          </DialogTitle>
          <DialogDescription className="text-right">
            כל הזמנה מקבלת קישור אישי לשליח — בלי התחברות. השליח רואה שם, כתובת וטלפון, ומסמן "נמסר"
            או "משלוח נכשל". הקישור בתוקף 7 ימים ונשאר פעיל עד שההזמנה נמסרה.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="courier-name">שם השליח (לא חובה)</Label>
            <Input
              id="courier-name"
              value={courierName}
              maxLength={80}
              placeholder="למשל: משה"
              onChange={(event) => setCourierName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="courier-phone">טלפון השליח (לוואטסאפ)</Label>
            <Input
              id="courier-phone"
              dir="ltr"
              inputMode="tel"
              value={courierPhone}
              maxLength={20}
              placeholder="050-0000000"
              className="text-right"
              onChange={(event) => setCourierPhone(event.target.value)}
            />
          </div>
        </div>

        {!ready && (
          <Button onClick={() => void submit()} disabled={saving || loadingLinks}>
            {saving || loadingLinks ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bike className="size-4" />
            )}
            {allWaiting ? "הפקת קישורים לשליח" : "מסירה לשליח וקבלת קישורים"}
          </Button>
        )}

        {ready && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((row) => (
              <li key={row.order.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-bold">
                      <span dir="ltr" className="numeric">
                        {row.order.order_number}
                      </span>
                      {row.attempts > 0 && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-400 text-amber-800 dark:text-amber-300"
                        >
                          <TriangleAlert className="size-3" aria-hidden="true" />
                          משלוח נכשל — ניסיון {row.attempts}
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.label.recipientName}
                      {row.label.cityLine ? ` · ${row.label.cityLine}` : ""}
                      {row.link && row.link.opened_count > 0
                        ? ` · השליח פתח ${row.link.opened_count} פעמים`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => void copy(row)}>
                      {copied === row.order.id ? (
                        <Check className="size-4 text-green-600" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied === row.order.id ? "הועתק" : "העתקה"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sharing === row.order.id}
                      onClick={() => void shareLabel(row)}
                    >
                      {sharing === row.order.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ImageIcon className="size-4" />
                      )}
                      מדבקה לשליח
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={whatsappLink(
                          courierMessage(row.label, courierUrlFor(row.token as string)),
                          courierPhone,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="size-4" />
                        וואטסאפ
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    dir="ltr"
                    value={courierUrlFor(row.token as string)}
                    className="h-8 font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button size="icon" variant="ghost" className="size-8 shrink-0" asChild>
                    <a
                      href={courierUrlFor(row.token as string)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="פתיחת הקישור"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {ready && (
          <DialogFooter className="flex-wrap gap-2 sm:justify-start">
            {rows.length > 1 && (
              <Button onClick={whatsappAll}>
                <MessageCircle className="size-4" />
                כל הקישורים בהודעה אחת לשליח
              </Button>
            )}
            <Button variant="outline" disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Bike className="size-4" />}
              שמירת פרטי השליח
            </Button>
            {rows.length === 1 && (
              <Button variant="ghost" disabled={saving} onClick={() => void submit(true)}>
                <RefreshCw className="size-4" />
                קישור חדש (ביטול הקודם)
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
