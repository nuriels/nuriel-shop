import { useEffect, useState } from "react";
import { Copy, FileText, Loader2, MessageCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { PosCartLine } from "@/lib/pos";
import { createQuote, sharedCartPath, shareLink } from "@/lib/shared-cart";
import { whatsappLink } from "@/lib/shipping-label";

/**
 * חלק 39ב: "שליחה כהצעת מחיר" מהקופה המהירה — המוצרים שבעגלת הקופה נשמרים
 * כהצעה (שם לקוח, הערה, תוקף) → קישור /cart/{code} לשליחה בווטסאפ / העתקה.
 * הלקוח פותח, בוחר מה לאשר ו"אשר והעבר לקופה". המחיר — לפי הלקוח בחנות.
 */
export function PosQuoteDialog({
  open,
  onOpenChange,
  lines,
  customerName,
  customerPhone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: PosCartLine[];
  customerName: string;
  customerPhone: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(customerName);
    setPhone(customerPhone);
    setNote("");
    setDays("7");
    setUrl(null);
  }, [open, customerName, customerPhone]);

  const edited = lines.some((line) => line.priceEdited);

  const create = async () => {
    const validDays = Math.round(Number(days));
    if (!Number.isFinite(validDays) || validDays < 1 || validDays > 90) {
      toast.error("תוקף ההצעה: בין יום אחד ל-90 ימים");
      return;
    }
    setBusy(true);
    try {
      const code = await createQuote({
        lines,
        customerName: name.trim(),
        note: note.trim(),
        validDays,
      });
      setUrl(`${window.location.origin}${sharedCartPath(code)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת ההצעה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const message = url
    ? `שלום${name.trim() ? ` ${name.trim()}` : ""}, מצורפת הצעת המחיר שלך: ${url}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="text-right sm:max-w-md" data-testid="pos-quote-dialog">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" aria-hidden="true" />
            שליחה כהצעת מחיר
          </DialogTitle>
          <DialogDescription>
            {lines.length} מוצרים מהקופה. הלקוח יקבל קישור, יבחר מה לאשר ויעבור לקופה באתר.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="space-y-3" data-testid="pos-quote-ready">
            <p className="text-sm font-medium">ההצעה מוכנה — שלחו את הקישור ללקוח:</p>
            <Input dir="ltr" readOnly value={url} data-testid="pos-quote-url" />
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={whatsappLink(message, phone)} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  שליחה בווטסאפ
                </a>
              </Button>
              <Button variant="outline" onClick={() => void shareLink(url, "הצעת מחיר")}>
                <Copy className="size-4" aria-hidden="true" />
                העתקת הקישור
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="quote-name">שם הלקוח (מופיע בהצעה)</Label>
              <Input
                id="quote-name"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-phone">נייד לווטסאפ (לא חובה)</Label>
              <Input
                id="quote-phone"
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-note">הערה ללקוח (לא חובה)</Label>
              <Textarea
                id="quote-note"
                maxLength={2000}
                rows={3}
                placeholder="למשל: כולל התקנה, אספקה תוך 3 ימי עסקים"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-days">תוקף ההצעה (ימים)</Label>
              <Input
                id="quote-days"
                type="number"
                min={1}
                max={90}
                className="w-28"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              המחירים בהצעה הם המחירים של הלקוח בחנות (מחירון / דרג).
              {edited && " מחיר ששיניתם ידנית בקופה לא נשמר בהצעה."}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          {url ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              סגירה
            </Button>
          ) : (
            <Button
              onClick={() => void create()}
              disabled={busy || lines.length === 0}
              data-testid="pos-quote-create"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              יצירת קישור להצעה
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
