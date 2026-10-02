import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserDetails } from "@/lib/admin.functions";
import type { Role } from "@/hooks/useAuthState";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";
import { PriceListTypeSelect } from "@/components/PriceListTypeSelect";
import { toPriceListType, type PriceListType } from "@/lib/price-list";

type FormState = {
  role: Role;
  priceTier: "none" | "1" | "2" | "3";
  priceListType: PriceListType;
  agentId: string;
  agentNumber: string;
  /** שם מלא בעברית — לעובדים בלבד */
  displayName: string;
  businessName: string;
  businessAddress: string;
  taxId: string;
  contactName: string;
  phone: string;
};

/**
 * עריכת משתמש קיים.
 * מנהל: תפקיד, קבוצת מחיר, שיוך סוכן, מספר סוכן וכל פרטי העסק.
 * סוכן: פרטי הקשר של הלקוחות המשויכים אליו בלבד (השדות האחרים חסומים).
 */
export function EditUserDialog({
  userId,
  label,
  currentRole,
  currentAgentNumber,
  currentDisplayName = null,
  isProtected = false,
  canManageRole,
  agents,
  onSaved,
}: {
  userId: string;
  label: string;
  currentRole: Role;
  currentAgentNumber: string | null;
  currentDisplayName?: string | null;
  isProtected?: boolean;
  /** true עבור מנהל בלבד — סוכן לא רשאי לשנות תפקיד/קבוצת מחיר */
  canManageRole: boolean;
  agents: { user_id: string; label: string }[];
  onSaved: () => void;
}) {
  const tiersEnabled = usePriceTiersEnabled();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [savedPriceListType, setSavedPriceListType] = useState<PriceListType>("regular");
  const [form, setForm] = useState<FormState>({
    role: currentRole,
    priceTier: "none",
    priceListType: "regular",
    agentId: "none",
    agentNumber: currentAgentNumber ?? "",
    displayName: currentDisplayName ?? "",
    businessName: "",
    businessAddress: "",
    taxId: "",
    contactName: "",
    phone: "",
  });

  const save = useServerFn(updateUserDetails);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("customer_profiles")
        .select(
          "business_name, business_address, tax_id, contact_name, phone, price_tier, price_list_type, agent_id",
        )
        .eq("user_id", userId)
        .maybeSingle();
      setHasProfile(data !== null);
      setSavedPriceListType(toPriceListType(data?.price_list_type));
      setForm({
        role: currentRole,
        priceTier: data?.price_tier ? (String(data.price_tier) as FormState["priceTier"]) : "none",
        priceListType: toPriceListType(data?.price_list_type),
        agentId: data?.agent_id ?? "none",
        agentNumber: currentAgentNumber ?? "",
        displayName: currentDisplayName ?? "",
        businessName: data?.business_name ?? "",
        businessAddress: data?.business_address ?? "",
        taxId: data?.tax_id ?? "",
        contactName: data?.contact_name ?? "",
        phone: data?.phone ?? "",
      });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await save({
        data: {
          userId,
          ...(canManageRole
            ? {
                role: form.role,
                priceTier: !tiersEnabled
                  ? 1
                  : form.priceTier === "none"
                    ? null
                    : (Number(form.priceTier) as 1 | 2 | 3),
                agentId: form.agentId === "none" ? null : form.agentId,
                ...(hasProfile ? { priceListType: form.priceListType } : {}),
                agentNumber: form.agentNumber,
                ...(form.role !== "customer" ? { displayName: form.displayName } : {}),
              }
            : {}),
          ...(hasProfile
            ? {
                businessName: form.businessName,
                businessAddress: form.businessAddress,
                taxId: form.taxId,
                contactName: form.contactName,
                phone: form.phone,
              }
            : {}),
        },
      });
      toast.success("פרטי המשתמש עודכנו");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "עדכון המשתמש נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="size-4" />
          עריכה
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת משתמש</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            טוען פרטים...
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {canManageRole && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>תפקיד</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) => patch({ role: v as Role })}
                    disabled={isProtected}
                  >
                    <SelectTrigger dir="rtl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="customer">לקוח</SelectItem>
                      <SelectItem value="agent">סוכן</SelectItem>
                      <SelectItem value="warehouse">מחסנאי (ליקוט בלבד)</SelectItem>
                      <SelectItem value="admin">מנהל</SelectItem>
                    </SelectContent>
                  </Select>
                  {isProtected && (
                    <p className="text-xs text-muted-foreground">
                      המנהל הראשי מוגן — אי אפשר לשנות לו תפקיד.
                    </p>
                  )}
                </div>

                {tiersEnabled && (
                  <div className="space-y-2">
                    <Label>קבוצת מחיר</Label>
                    <Select
                      value={form.priceTier}
                      onValueChange={(v) => patch({ priceTier: v as FormState["priceTier"] })}
                      disabled={!hasProfile}
                    >
                      <SelectTrigger dir="rtl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="none">ללא קבוצה (הצעת מחיר בלבד)</SelectItem>
                        <SelectItem value="1">דרג 1</SelectItem>
                        <SelectItem value="2">דרג 2</SelectItem>
                        <SelectItem value="3">דרג 3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {hasProfile && form.role === "customer" && (
                  <div className="space-y-2">
                    <PriceListTypeSelect
                      value={form.priceListType}
                      onChange={(priceListType) => patch({ priceListType })}
                    />
                    {savedPriceListType === "custom" && form.priceListType === "regular" && (
                      <p className="text-xs text-muted-foreground">
                        הלקוח יחזור למחירים הרגילים. המחירים האישיים שנקבעו לו נשמרים (לא פעילים) —
                        וחוזרים אם יוחזר למחירון אישי.
                      </p>
                    )}
                    {savedPriceListType === "regular" && form.priceListType === "custom" && (
                      <p className="text-xs text-muted-foreground">
                        אחרי השמירה קובעים את המחירים בלשונית &quot;ניהול מחירי לקוחות
                        מיוחדים&quot;. מוצר בלי מחיר אישי נשאר במחיר הרגיל.
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>סוכן מטפל</Label>
                  <Select
                    value={form.agentId}
                    onValueChange={(v) => patch({ agentId: v })}
                    disabled={!hasProfile}
                  >
                    <SelectTrigger dir="rtl">
                      <SelectValue placeholder="ללא סוכן" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">ללא סוכן</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.user_id} value={agent.user_id}>
                          {agent.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {form.role !== "customer" && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-display-name">שם מלא בעברית</Label>
                    <Input
                      id="edit-display-name"
                      value={form.displayName}
                      maxLength={60}
                      onChange={(e) => patch({ displayName: e.target.value })}
                      placeholder="למשל: יוסי כהן"
                    />
                    <p className="text-xs text-muted-foreground">
                      זה השם שהלקוחות רואים במסמכי ההזמנה, במייל ובאזור האישי — במקום שם המשתמש.
                    </p>
                  </div>
                )}

                {form.role === "agent" && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-agent-number">מספר סוכן</Label>
                    <Input
                      id="edit-agent-number"
                      dir="ltr"
                      className="numeric"
                      value={form.agentNumber}
                      onChange={(e) => patch({ agentNumber: e.target.value })}
                    />
                  </div>
                )}
              </div>
            )}

            {hasProfile ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-business">שם העסק</Label>
                    <Input
                      id="edit-business"
                      value={form.businessName}
                      onChange={(e) => patch({ businessName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-tax">ח.פ / עוסק מורשה</Label>
                    <Input
                      id="edit-tax"
                      dir="ltr"
                      value={form.taxId}
                      onChange={(e) => patch({ taxId: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-address">כתובת</Label>
                  <Input
                    id="edit-address"
                    value={form.businessAddress}
                    onChange={(e) => patch({ businessAddress: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-contact">איש קשר</Label>
                    <Input
                      id="edit-contact"
                      value={form.contactName}
                      onChange={(e) => patch({ contactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-phone">טלפון</Label>
                    <Input
                      id="edit-phone"
                      type="tel"
                      dir="ltr"
                      value={form.phone}
                      onChange={(e) => patch({ phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                לחשבון צוות אין פרטי עסק לעריכה.
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "שומר..." : "שמירת השינויים"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
