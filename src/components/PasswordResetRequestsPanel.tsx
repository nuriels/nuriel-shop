import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, KeyRound, MailQuestion, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendPasswordResetLink } from "@/lib/password.functions";

type ResetRequest = {
  id: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: "new" | "handled";
  created_at: string;
};

/** בקשות איפוס סיסמה שנשלחו מדף ההתחברות – לסופר-אדמין בלבד */
export function PasswordResetRequestsPanel() {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const sendResetLink = useServerFn(sendPasswordResetLink);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("password_reset_requests")
      .select("id, email, phone, message, status, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRequests((data as ResetRequest[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** שליחת קישור איפוס חד-פעמי לפי כתובת המייל שבבקשה */
  const sendResetToRequest = async (request: ResetRequest) => {
    setBusy(request.id);
    try {
      const { data: user, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("email", request.email.trim().toLowerCase())
        .maybeSingle();
      if (error) throw error;
      if (!user) throw new Error("לא נמצא משתמש עם כתובת המייל הזו");
      await sendResetLink({ data: { userId: user.user_id } });
      toast.success("נשלח קישור לקביעת סיסמה חדשה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הקישור נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const markHandled = async (request: ResetRequest) => {
    setBusy(request.id);
    const { error } = await supabase
      .from("password_reset_requests")
      .update({ status: "handled" })
      .eq("id", request.id);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הבקשה סומנה כטופלה");
    void load();
  };

  const remove = async (request: ResetRequest) => {
    setBusy(request.id);
    const { error } = await supabase.from("password_reset_requests").delete().eq("id", request.id);
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  };

  const pending = requests.filter((r) => r.status === "new").length;

  return (
    <Card className="border-border shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MailQuestion className="size-5 text-primary" />
          בקשות איפוס סיסמה
        </CardTitle>
        {pending > 0 && (
          <Badge className="gradient-brand border-0 text-primary-foreground">{pending} חדשות</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            אין בקשות פתוחות. משתמשים יכולים לאפס סיסמה בעצמם דרך "שכחתי סיסמה" בדף ההתחברות.
          </p>
        ) : (
          requests.map((request) => (
            <div
              key={request.id}
              className="space-y-3 rounded-xl border border-border p-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0"
            >
              <div className="min-w-0 space-y-1">
                <p dir="ltr" className="truncate text-right text-sm font-medium">
                  {request.email}
                </p>
                {request.phone !== null && (
                  <p dir="ltr" className="text-right text-xs text-muted-foreground">
                    {request.phone}
                  </p>
                )}
                {request.message !== null && (
                  <p className="text-xs text-muted-foreground">{request.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Date(request.created_at).toLocaleString("he-IL")} ·{" "}
                  {request.status === "new" ? "ממתינה לטיפול" : "טופלה"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={busy === request.id}
                  onClick={() => void sendResetToRequest(request)}
                >
                  <KeyRound className="size-4" />
                  שלח איפוס
                </Button>
                {request.status === "new" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy === request.id}
                    onClick={() => void markHandled(request)}
                  >
                    <Check className="size-4" />
                    טופל
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 text-destructive"
                  aria-label="מחיקת הבקשה"
                  disabled={busy === request.id}
                  onClick={() => void remove(request)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
