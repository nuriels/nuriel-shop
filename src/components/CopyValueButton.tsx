import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** העתקת ערך ללוח — עם גיבוי כשאין הרשאת לוח (http) */
export function CopyValueButton({
  value,
  label,
  copiedText = "הועתק",
}: {
  value: string;
  label: string;
  copiedText?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(copiedText);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          toast.info(value);
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "הועתק!" : label}
    </Button>
  );
}
