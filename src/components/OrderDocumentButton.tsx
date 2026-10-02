import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadOrderDocument } from "@/lib/email.functions";
import { downloadPickingSlip } from "@/lib/orders.functions";

/**
 * הורדת מסמך ה-PDF של הזמנה/הצעת מחיר.
 * המסמך נוצר בשרת (אותו קוד שמצרף אותו למייל) ומוחזר כ-base64, כדי שלא
 * יהיה צורך בקישור ציבורי לקובץ.
 */
export function OrderDocumentButton({
  orderId,
  label = "הורדת מסמך PDF",
  variant = "outline",
  className,
  kind = "document",
}: {
  orderId: string;
  label?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
  /** "document" = אישור הזמנה/הצעת מחיר ללקוח · "picking" = בון ליקוט למחסן */
  kind?: "document" | "picking";
}) {
  const [busy, setBusy] = useState(false);
  const fetchDocument = useServerFn(downloadOrderDocument);
  const fetchPickingSlip = useServerFn(downloadPickingSlip);

  const download = async () => {
    setBusy(true);
    try {
      const { filename, base64 } =
        kind === "picking"
          ? await fetchPickingSlip({ data: { orderId } })
          : await fetchDocument({ data: { orderId } });
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפקת המסמך נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      disabled={busy}
      onClick={() => void download()}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : kind === "picking" ? (
        <Printer className="size-4" />
      ) : (
        <FileDown className="size-4" />
      )}
      {label}
    </Button>
  );
}
