import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Ban,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getBitReceipt, type BitReceiptLinks } from "@/lib/bit-payments.functions";
import { paymentStatusLabel, type PaymentMethod, type PaymentStatus } from "@/lib/bit-payments";
import { cn } from "@/lib/utils";

type BitOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_method?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  payment_due_at?: string | null;
  payment_reported_at?: string | null;
  bit_transaction_id?: string | null;
  bit_receipt_url?: string | null;
};

const israelTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

/**
 * תשלום בביט בכרטיס ההזמנה (חלק 17ב): מה הלקוח שלח (אסמכתא / צילום מסך),
 * ואישור / דחייה של בעל החנות. רק מנהל החנות רואה את צילום המסך ומאשר;
 * סוכן רואה את המצב בלבד. האישור והדחייה — RPC bit_payment_review (המסד
 * בודק שוב שהמשתמש מנהל החנות).
 */
export function BitPaymentReview({
  order,
  canReview,
  onChanged,
}: {
  order: BitOrder;
  canReview: boolean;
  onChanged: () => void;
}) {
  const loadReceipt = useServerFn(getBitReceipt);
  const [busy, setBusy] = useState<"approve" | "reject" | "receipt" | null>(null);
  const [receipt, setReceipt] = useState<BitReceiptLinks | null>(null);

  if (order.payment_method !== "bit") return null;
  const status = (order.payment_status ?? "awaiting") as PaymentStatus;
  const label = paymentStatusLabel("bit" as PaymentMethod, status);
  const waitingReview = status === "awaiting_verification";
  const paid = status === "paid";
  const closed = status === "rejected" || status === "expired";

  const review = async (approve: boolean) => {
    if (
      !approve &&
      !window.confirm(`לדחות את התשלום ולבטל את הזמנה ${order.order_number}? המוצרים יחזרו למלאי.`)
    ) {
      return;
    }
    if (
      approve &&
      status === "awaiting" &&
      !window.confirm(
        `הלקוח עוד לא שלח אישור העברה. לאשר שהתשלום על הזמנה ${order.order_number} התקבל בביט?`,
      )
    ) {
      return;
    }
    setBusy(approve ? "approve" : "reject");
    try {
      const { error } = await supabase.rpc("bit_payment_review", {
        _order: order.id,
        _approve: approve,
      });
      if (error) throw new Error(error.message);
      toast.success(
        approve
          ? `התשלום על הזמנה ${order.order_number} אושר — ההזמנה פתוחה לטיפול`
          : `התשלום נדחה והזמנה ${order.order_number} בוטלה`,
      );
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפעולה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const showReceipt = async () => {
    if (receipt) {
      setReceipt(null);
      return;
    }
    setBusy("receipt");
    try {
      setReceipt(await loadReceipt({ data: { orderId: order.id } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "פתיחת צילום המסך נכשלה");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-bit-review={order.id}
      className={cn(
        "space-y-2 rounded-lg border-2 p-3 text-sm",
        waitingReview
          ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/30"
          : paid
            ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30"
            : closed
              ? "border-border bg-muted/50"
              : "border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30",
      )}
    >
      <p className="flex flex-wrap items-center gap-2 font-bold text-foreground">
        <Smartphone className="size-4" aria-hidden="true" />
        תשלום בביט — {label}
      </p>

      {status === "awaiting" && (
        <p className="text-xs text-muted-foreground">
          הלקוח עוד לא שלח אישור העברה.{" "}
          {order.payment_due_at
            ? `אם לא יתקבל תשלום עד ${israelTime(order.payment_due_at)} — ההזמנה תבוטל אוטומטית.`
            : ""}
        </p>
      )}
      {order.payment_reported_at && (
        <p className="text-xs text-muted-foreground">
          הלקוח דיווח על העברה: {israelTime(order.payment_reported_at)}
        </p>
      )}
      {paid && order.paid_at && (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          אושר: {israelTime(order.paid_at)}
        </p>
      )}

      {(order.bit_transaction_id || order.bit_receipt_url) && (
        <div className="flex flex-wrap items-center gap-2">
          {order.bit_transaction_id && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
              <span className="text-xs text-muted-foreground">אסמכתא:</span>
              <span dir="ltr" className="numeric font-semibold">
                {order.bit_transaction_id}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label="העתקת מספר האסמכתא"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(order.bit_transaction_id ?? "")
                    .then(() => toast.success("מספר האסמכתא הועתק"))
                    .catch(() => undefined)
                }
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
          {order.bit_receipt_url &&
            (canReview ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 bg-card"
                disabled={busy !== null}
                onClick={() => void showReceipt()}
              >
                {busy === "receipt" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageIcon className="size-4" aria-hidden="true" />
                )}
                {receipt ? "הסתרת צילום המסך" : "צפייה בצילום המסך"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">צולם מסך (המנהל רואה אותו)</span>
            ))}
        </div>
      )}

      {receipt && (
        <div className="space-y-2 rounded-md border border-border bg-card p-2">
          {receipt.isImage ? (
            <a href={receipt.viewUrl} target="_blank" rel="noreferrer">
              <img
                src={receipt.viewUrl}
                alt={`צילום מסך של ההעברה בביט — הזמנה ${order.order_number}`}
                className="max-h-96 w-full rounded object-contain"
              />
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              {receipt.isPdf ? "קובץ PDF" : "קובץ שלא מוצג בדפדפן (למשל HEIC)"} — פתחו או הורידו:
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={receipt.viewUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                פתיחה בלשונית חדשה
              </a>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={receipt.downloadUrl}>
                <Download className="size-4" aria-hidden="true" />
                הורדה
              </a>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">הקישור תקף ל-5 דקות.</p>
        </div>
      )}

      {canReview && !paid && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={busy !== null}
            onClick={() => void review(true)}
          >
            {busy === "approve" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            )}
            {closed ? "אישור בכל זאת (התשלום התקבל)" : "אישור תשלום"}
          </Button>
          {!closed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy !== null}
              onClick={() => void review(false)}
            >
              {busy === "reject" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Ban className="size-4" aria-hidden="true" />
              )}
              דחייה וביטול ההזמנה
            </Button>
          )}
          {waitingReview && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              בדקו באפליקציית ביט שהכסף התקבל לפני האישור
            </span>
          )}
        </div>
      )}
    </div>
  );
}
