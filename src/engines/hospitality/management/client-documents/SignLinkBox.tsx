// דרך ב' (הלקוח ממלא): הקישור לחתימה — מוצג פעם אחת, כדי להעביר אותו ללקוח (העתקה / וואטסאפ).
// הוא לא נשמר במערכת (במסד — רק הטביעה שלו); אחרי סגירת התיבה אפשר רק ליצור קישור חדש (הקודם מת).
import { Check, Copy, MessageCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label } from "@/platform/ui";
import { formatDateTime } from "../lib/format";
import { whatsappHref } from "./model";

export function SignLinkBox({
  url,
  expiresAt,
  title,
  phone,
  number,
}: {
  url: string;
  expiresAt: string;
  title: string;
  phone: string | null;
  number: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("ההעתקה לא הצליחה — סמנו את הקישור והעתיקו ידנית");
    }
  };
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950"
      data-testid="sign-link-box"
    >
      <p className="font-semibold">הקישור לחתימה על מסמך #{number} מוכן — העבירו אותו ללקוח</p>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`sign-link-${number}`}>הקישור (תקף עד {formatDateTime(expiresAt)})</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`sign-link-${number}`}
            readOnly
            dir="ltr"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 min-w-0 flex-1 bg-white font-mono text-xs"
            data-testid="sign-link-url"
          />
          <Button type="button" className="min-h-11 gap-2" onClick={() => void copy()}>
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "הועתק" : "העתקה"}
          </Button>
          <a
            href={whatsappHref(url, title, phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-emerald-400 bg-white px-3 font-medium hover:bg-emerald-100"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            שליחה בוואטסאפ
          </a>
        </div>
      </div>
      <p className="flex items-start gap-2 text-xs">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          הקישור מוצג עכשיו בלבד — הוא לא נשמר במערכת. מי שמחזיק בו יכול למלא את הפרטים ולחתום (פעם
          אחת), לכן העבירו אותו רק ללקוח. צריך שוב? יוצרים קישור חדש, והקודם מפסיק לעבוד.
        </span>
      </p>
    </div>
  );
}
