import { useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sslView, type SslFields } from "@/lib/ssl-status";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  ok: "text-green-700",
  warn: "text-amber-600",
  bad: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/**
 * תעודת ה-SSL של חנות: כמה זמן נשאר, ולחצן "חידוש תעודה" — הבקשה נשמרת
 * במסד והשרת (store-certs.sh) מבצע אותה תוך כדקה.
 */
export function SslCell({
  store,
  onRequested,
}: {
  store: SslFields & { id: string; name: string; ssl_host: string | null };
  onRequested: (requestedAt: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = sslView(store);
  const Icon =
    view.tone === "ok" ? ShieldCheck : view.tone === "muted" ? ShieldQuestion : ShieldAlert;

  const request = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("platform_request_ssl_renewal", {
      _tenant: store.id,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "שליחת הבקשה נכשלה");
      return;
    }
    onRequested(data);
    toast.success("הבקשה נשלחה לשרת — התעודה תחודש תוך כדקה");
  };

  return (
    <div className="space-y-1 text-xs">
      <div
        className={cn(
          "flex items-center gap-1 font-medium whitespace-nowrap",
          TONE_CLASS[view.tone],
        )}
      >
        {view.renewing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
        {view.label}
      </div>
      {view.detail && (
        <div className="max-w-56 text-muted-foreground" title={view.detail}>
          <span className="line-clamp-2">{view.detail}</span>
        </div>
      )}
      {view.canRenew && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <RefreshCw className="size-3.5" /> חידוש תעודה
        </Button>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לחדש עכשיו את התעודה של "{store.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              השרת ינפיק תעודה חדשה מ-Let's Encrypt עבור <span dir="ltr">{store.ssl_host}</span> תוך
              כדקה. בדרך כלל אין בזה צורך — התעודות מתחדשות לבד. Let's Encrypt מגביל ל-5 הנפקות
              בשבוע לאותה כתובת.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                void request();
              }}
            >
              חידוש תעודה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
