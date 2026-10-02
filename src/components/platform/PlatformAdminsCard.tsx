import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PlatformAdmin = { user_id: string; email: string; created_at: string };

/**
 * מנהלי-על של הפלטפורמה: הוספה לפי אימייל של חשבון קיים, והסרה.
 * המסד לא מאפשר להסיר את עצמך או את מנהל-העל האחרון.
 */
export function PlatformAdminsCard({ currentUserId }: { currentUserId: string }) {
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<PlatformAdmin | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_list_admins", {});
    if (error) toast.error(error.message);
    else setAdmins(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("platform_add_admin", { _email: email.trim() });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${email.trim()} נוסף כמנהל-על`);
    setEmail("");
    void load();
  };

  const remove = async (admin: PlatformAdmin) => {
    setBusy(true);
    const { error } = await supabase.rpc("platform_remove_admin", { _user_id: admin.user_id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${admin.email} הוסר ממנהלי-העל`);
    void load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5" /> מנהלי-על ({admins.length})
        </CardTitle>
        <CardDescription>
          גישה מלאה לפאנל הזה: הקמת חנויות, הקפאה ושחרור, מנויים ומנהלי-על. ניתן להוסיף רק חשבון
          שכבר קיים במערכת (המשתמש נרשם או התחבר פעם אחת).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border">
          {admins.map((admin) => (
            <li key={admin.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="text-sm">
                <span dir="ltr">{admin.email}</span>
                {admin.user_id === currentUserId && (
                  <Badge variant="secondary" className="ms-2">
                    אני
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy || admin.user_id === currentUserId || admins.length <= 1}
                title={admin.user_id === currentUserId ? "אי אפשר להסיר את עצמך" : undefined}
                onClick={() => setToRemove(admin)}
              >
                <Trash2 className="size-4" /> הסרה
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Input
            type="email"
            required
            dir="ltr"
            placeholder="admin@example.com"
            className="max-w-xs"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy || email.trim() === ""}>
            הוספת מנהל-על
          </Button>
        </form>
      </CardContent>

      <AlertDialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>להסיר את {toRemove?.email} ממנהלי-העל?</AlertDialogTitle>
            <AlertDialogDescription>
              החשבון עצמו לא נמחק — רק הגישה לפאנל הפלטפורמה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (toRemove) void remove(toRemove);
                setToRemove(null);
              }}
            >
              הסרה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
