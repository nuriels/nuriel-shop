import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import {
  EXTRA_ADMIN_YEARLY_PRICE,
  formatSeatDate,
  loadPlatformUpgradeRequests,
  planLabel,
  platformApproveUpgrade,
  platformDeleteUpgradeRequest,
  platformSendUpgradeLink,
  type PlatformUpgradeRequest,
} from "@/lib/admin-seats";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/platform_/upgrades")({
  head: () => ({
    meta: [
      { title: `בקשות שדרוג | ${PLATFORM_SITE_NAME}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UpgradesPage,
});

function UpgradesPage() {
  return <PlatformShell active="upgrades">{() => <UpgradeRequestsPanel />}</PlatformShell>;
}

const STATUS: Record<
  PlatformUpgradeRequest["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  pending: { label: "ממתין לקישור תשלום", variant: "default" },
  payment_link_sent: { label: "קישור נשלח — ממתין לתשלום", variant: "secondary" },
  approved: { label: "אושר", variant: "outline" },
};

/** "בקשות שדרוג": קישור תשלום ללקוח → אישור אחרי התשלום (מנהל נוסף לחנות) */
function UpgradeRequestsPanel() {
  const [rows, setRows] = useState<PlatformUpgradeRequest[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await loadPlatformUpgradeRequests());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת הבקשות נכשלה");
      setRows([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפעולה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> טוען בקשות…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UserPlus className="size-6" aria-hidden="true" />
          בקשות שדרוג
        </h1>
        <p className="text-sm text-muted-foreground">
          מנהל נוסף לחנות — {EXTRA_ADMIN_YEARLY_PRICE}₪ לשנה. שולחים קישור תשלום, ואחרי התשלום
          מאשרים: המגבלה של החנות גדלה במנהל אחד.
        </p>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            אין בקשות שדרוג
          </CardContent>
        </Card>
      ) : (
        rows.map((r) => (
          <Card key={r.id} data-upgrade-request={r.status}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">{r.tenant_name}</p>
                  <p dir="ltr" className="text-left text-xs text-muted-foreground">
                    {r.tenant_slug}
                    {r.owner_email ? ` · ${r.owner_email}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </div>
              <p className="numeric text-sm text-muted-foreground">
                מנהל נוסף · חבילה {planLabel(r.plan)} · מנהלים {r.admins_used} מתוך {r.admin_limit}
                {r.extra_admins > 0 ? ` (כולל ${r.extra_admins} נוספים)` : ""} · נשלחה{" "}
                {formatSeatDate(r.created_at)}
                {r.approved_at ? ` · אושרה ${formatSeatDate(r.approved_at)}` : ""}
              </p>
              {r.status !== "approved" && (
                <div className="space-y-2">
                  <Label htmlFor={`pay-${r.id}`}>קישור תשלום (https://…)</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id={`pay-${r.id}`}
                      dir="ltr"
                      inputMode="url"
                      placeholder="https://"
                      value={urls[r.id] ?? r.payment_url ?? ""}
                      onChange={(e) => setUrls((u) => ({ ...u, [r.id]: e.target.value }))}
                    />
                    <Button
                      disabled={busy === r.id || !(urls[r.id] ?? r.payment_url ?? "").trim()}
                      onClick={() =>
                        void act(
                          r.id,
                          () => platformSendUpgradeLink(r.id, urls[r.id] ?? r.payment_url ?? ""),
                          "הקישור נשלח ללקוח",
                        )
                      }
                    >
                      <Send className="size-4" aria-hidden="true" />
                      שלח ללקוח
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `לאשר מנהל נוסף ל"${r.tenant_name}"? (אחרי שהתשלום התקבל)`,
                          )
                        )
                          return;
                        void act(
                          r.id,
                          () => platformApproveUpgrade(r.id),
                          "השדרוג אושר — נוסף מנהל לחנות",
                        );
                      }}
                    >
                      <Check className="size-4" aria-hidden="true" />
                      אשר שדרוג
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy === r.id}
                      onClick={() => {
                        if (!window.confirm("למחוק את הבקשה?")) return;
                        void act(r.id, () => platformDeleteUpgradeRequest(r.id), "הבקשה נמחקה");
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      מחיקה
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
