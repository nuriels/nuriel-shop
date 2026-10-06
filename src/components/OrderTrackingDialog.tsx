import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, type OrderRow, type OrderStatus } from "@/lib/orders";
import { saveOrderTracking, SHIPPING_PROVIDERS, TRACKING_URL_FORMAT } from "@/lib/order-tracking";

/** חלק 24: "פרטי שילוח ומעקב" — סטטוס, חברת שילוח, מספר מעקב וקישור למעקב */
export function OrderTrackingDialog({
  order,
  onClose,
  onSaved,
}: {
  order: OrderRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [provider, setProvider] = useState("");
  const [number, setNumber] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return;
    setStatus(order.status);
    setProvider(order.shipping_provider ?? "");
    setNumber(order.tracking_number ?? "");
    setUrl(order.tracking_url ?? "");
  }, [order]);

  const save = async () => {
    if (!order) return;
    if (url.trim() && !TRACKING_URL_FORMAT.test(url.trim())) {
      toast.error("קישור המעקב חייב להתחיל ב-https://");
      return;
    }
    setBusy(true);
    try {
      await saveOrderTracking(order.id, {
        ...(status !== order.status ? { status } : {}),
        provider,
        number,
        url,
      });
      toast.success("פרטי השילוח נשמרו");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="text-right sm:max-w-lg">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-5" aria-hidden="true" />
            פרטי שילוח ומעקב
          </DialogTitle>
          <DialogDescription>
            הזמנה <span dir="ltr">{order?.order_number}</span> — הלקוח רואה את מספר המעקב והקישור
            באזור האישי.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>סטטוס ההזמנה</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {ORDER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              שינוי הסטטוס כאן לא שולח מייל ללקוח — למייל &quot;נשלח&quot; השתמשו בפעולות שבכרטיס
              ההזמנה.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trk-provider">חברת שילוח</Label>
            <Input
              id="trk-provider"
              list="trk-providers"
              value={provider}
              maxLength={60}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="דואר ישראל / צ'יטה / HFD…"
            />
            <datalist id="trk-providers">
              {SHIPPING_PROVIDERS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trk-number">מספר מעקב</Label>
            <Input
              id="trk-number"
              dir="ltr"
              value={number}
              maxLength={80}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trk-url">קישור למעקב</Label>
            <Input
              id="trk-url"
              dir="ltr"
              inputMode="url"
              placeholder="https://"
              value={url}
              maxLength={1000}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
