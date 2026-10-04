import { ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const CODE_LENGTH = 6;

/** כל מה שאינו ספרה יוצא: "123 456", "קוד: 123-456", רווחים ושורות מהמייל */
function codeDigits(text: string): string {
  return text.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/**
 * שדה הקוד בן 6 הספרות (ריבוע לכל ספרה) — עם הדבקה מהירה:
 *  - Ctrl+V / לחיצה ארוכה → "הדבק" על הריבועים: רווחים, מקפים וטקסט מסביב
 *    מסוננים (pasteTransformer), כך שגם "123 456" או "הקוד שלך: 123456" עובדים.
 *  - כפתור "הדבקת הקוד מהלוח" — קורא את הלוח ושולח מיד כשיש 6 ספרות.
 *  - בטלפון: הצעת הקוד מההודעה (autoComplete="one-time-code").
 */
export function OtpCodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
}) {
  const canReadClipboard =
    typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  const pasteFromClipboard = async () => {
    try {
      const digits = codeDigits(await navigator.clipboard.readText());
      if (digits.length !== CODE_LENGTH) {
        toast.error("בלוח אין קוד בן 6 ספרות — העתיקו את הקוד מהמייל ונסו שוב");
        return;
      }
      onChange(digits);
      onComplete(digits);
    } catch {
      toast.error("הדפדפן לא איפשר לקרוא מהלוח — לחצו על הריבועים והדביקו (Ctrl+V או לחיצה ארוכה)");
    }
  };

  return (
    <div className="space-y-2">
      <div dir="ltr" className="flex justify-center">
        <InputOTP
          id={id}
          maxLength={CODE_LENGTH}
          inputMode="numeric"
          pattern="^[0-9]*$"
          autoComplete="one-time-code"
          autoFocus
          value={value}
          disabled={disabled}
          pasteTransformer={codeDigits}
          onChange={onChange}
          onComplete={(next: string) => onComplete(next)}
        >
          <InputOTPGroup>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <InputOTPSlot key={index} index={index} className="size-12 text-xl font-bold" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {canReadClipboard && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void pasteFromClipboard()}
          className="mx-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ClipboardPaste className="size-4" aria-hidden="true" />
          הדבקת הקוד מהלוח
        </button>
      )}
    </div>
  );
}
