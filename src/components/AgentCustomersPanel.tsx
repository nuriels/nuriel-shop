import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendPasswordResetLink } from "@/lib/password.functions";
import { CustomerFileDialog } from "@/components/CustomerFileDialog";
import { EditUserDialog } from "@/components/EditUserDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCustomerDialog } from "@/components/CreateCustomerDialog";
import { InviteCustomerDialog } from "@/components/InviteCustomerDialog";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";

type AgentCustomer = {
  user_id: string;
  business_name: string;
  /** null אפשרי: לקוח שהוקם ע"י מנהל וטרם השלים את פרטיו בכניסה הראשונה */
  contact_name: string | null;
  phone: string | null;
  price_tier: number | null;
  email: string;
  is_approved: boolean;
  is_blocked: boolean;
};

/** רשימת הלקוחות המשויכים לסוכן המחובר, עם יצירת לקוח ואיפוס סיסמה */
export function AgentCustomersPanel({ agentId }: { agentId: string }) {
  const tiersEnabled = usePriceTiersEnabled();
  const [customers, setCustomers] = useState<AgentCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const sendResetLink = useServerFn(sendPasswordResetLink);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profiles, error } = await supabase
      .from("customer_profiles")
      .select("user_id, business_name, contact_name, phone, price_tier")
      .eq("agent_id", agentId);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const ids = (profiles ?? []).map((p) => p.user_id);
    const { data: roles } = ids.length
      ? await supabase
          .from("user_roles")
          .select("user_id, email, is_approved, is_blocked")
          .in("user_id", ids)
      : { data: [] };
    const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r]));
    setCustomers(
      (profiles ?? []).map((p) => ({
        ...p,
        email: roleMap.get(p.user_id)?.email ?? "",
        is_approved: roleMap.get(p.user_id)?.is_approved ?? false,
        is_blocked: roleMap.get(p.user_id)?.is_blocked ?? false,
      })),
    );
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** קישור חד-פעמי (3 שעות) לקביעת סיסמה חדשה — נשלח למייל של הלקוח */
  const resetPassword = async (customer: AgentCustomer) => {
    setBusy(customer.user_id);
    try {
      await sendResetLink({ data: { userId: customer.user_id } });
      toast.success(`נשלח ללקוח קישור לקביעת סיסמה חדשה (${customer.email})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הקישור נכשלה");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
            <Users className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">הלקוחות שלי</h2>
            <p className="text-sm text-muted-foreground">
              {loading ? "טוען..." : `${customers.length} לקוחות משויכים`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            רענון נתונים
          </Button>
          <InviteCustomerDialog isAgent />
          <CreateCustomerDialog defaultAgentId={agentId} onCreated={load} />
        </div>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">רשימת לקוחות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {customers.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">עדיין אין לקוחות משויכים אליך</p>
          ) : (
            customers.map((customer) => (
              <div
                key={customer.user_id}
                className="space-y-2 rounded-xl border border-border p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {customer.business_name}
                  </span>
                  {tiersEnabled && (
                    <Badge variant={customer.price_tier === null ? "outline" : "secondary"}>
                      {customer.price_tier === null
                        ? "ללא קבוצה / אורח"
                        : `דרג ${customer.price_tier}`}
                    </Badge>
                  )}
                  <Badge
                    variant={
                      customer.is_blocked
                        ? "destructive"
                        : customer.is_approved
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {customer.is_blocked ? "חסום" : customer.is_approved ? "מאושר" : "ממתין לאישור"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {customer.contact_name} · {customer.phone} ·{" "}
                  <span dir="ltr">{customer.email}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <CustomerFileDialog
                    userId={customer.user_id}
                    label={customer.business_name || customer.email}
                  />
                  <EditUserDialog
                    userId={customer.user_id}
                    label={customer.business_name || customer.email}
                    currentRole="customer"
                    currentAgentNumber={null}
                    canManageRole={false}
                    agents={[]}
                    onSaved={load}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === customer.user_id}
                    onClick={() => resetPassword(customer)}
                  >
                    <KeyRound className="size-4" />
                    איפוס סיסמה
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
