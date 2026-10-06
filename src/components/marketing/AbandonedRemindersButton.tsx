import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** חלק 27: תזכורת אוטומטית לכל הסלים שננטשו לפני יותר מ-4 שעות ועוד לא קיבלו תזכורת */
export function AbandonedRemindersButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!window.confirm("לשלוח תזכורת לכל הסלים שננטשו לפני יותר מ-4 שעות ועוד לא קיבלו תזכורת?"))
      return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("נדרשת התחברות");
      const res = await fetch("/api/admin/trigger-abandoned-carts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => null)) as {
        due?: number;
        sent?: number;
        failed?: number;
        errors?: string[];
        error?: string;
      } | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "השליחה נכשלה");
      if (!body.due) toast.info("אין סלים שמחכים לתזכורת כרגע");
      else if (body.failed) {
        toast.warning(
          `נשלחו ${body.sent ?? 0} תזכורות, ${body.failed} נכשלו: ${(body.errors ?? []).join(" · ")}`,
        );
      } else toast.success(`נשלחו ${body.sent ?? 0} תזכורות`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" onClick={() => void run()} disabled={busy}>
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Send className="size-4" aria-hidden="true" />
      )}
      תזכורות לסלים מעל 4 שעות
    </Button>
  );
}
