// Billing & Agreements — "בקשות שינוי חבילה" בפאנל הפלטפורמה: כל הבקשות הממתינות (חנויות וצימרים, או
// מנוע אחד), ולכל בקשה — פתיחת כרטיס ההסכם והתשלומים של העסק, שם מאשרים (וקובעים מחיר) או דוחים.
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from "@/platform/ui";
import { platformBillingRequests } from "../billing.functions";
import { CYCLE_LABELS, ENGINE_LABELS, errorMessage, formatDate, formatMoney } from "../logic";
import type { Engine, UpgradeRequest } from "../types";
import { BillingAdminCard } from "./BillingAdminCard";

export function BillingRequestsPanel(props: { engine?: Engine }) {
  const [rows, setRows] = useState<UpgradeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<UpgradeRequest | null>(null);
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try {
      const all = await platformBillingRequests({ data: { status: "pending" } });
      setRows(props.engine ? all.filter((r) => r.engine === props.engine) : all);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    }
  }, [props.engine]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card data-testid="billing-requests">
      <CardHeader>
        <CardTitle className="text-lg">
          בקשות לשינוי חבילה {rows ? `(${rows.length})` : ""}
        </CardTitle>
        <CardDescription>
          בעלי עסקים שביקשו לשדרג או להחליף חבילה. אין חיוב ואין שינוי בחבילה עד שמאשרים כאן.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!rows ? (
          <Loader2 className="size-4 animate-spin" aria-label="טוען" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין בקשות ממתינות.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                data-testid="billing-request-row"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{r.tenant_label}</strong>
                    {r.engine ? <Badge variant="outline">{ENGINE_LABELS[r.engine]}</Badge> : null}
                  </div>
                  <div className="text-muted-foreground">
                    {r.current_plan_name} ← {r.requested_plan_name} (
                    {CYCLE_LABELS[r.requested_cycle]})
                    {r.list_price_monthly !== null
                      ? ` · מחירון ${formatMoney(r.list_price_monthly)} לחודש`
                      : ""}{" "}
                    · {formatDate(r.created_at)}
                    {r.requested_by_email ? ` · ${r.requested_by_email}` : ""}
                  </div>
                  {r.customer_note ? <div>"{r.customer_note}"</div> : null}
                </div>
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => setOpen(r)}
                  data-testid="billing-request-open"
                >
                  טיפול בבקשה
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent
          side={isMobile ? "bottom" : "left"}
          className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader className="ps-10 text-start sm:text-start">
            <SheetTitle>{open?.tenant_label}</SheetTitle>
            <SheetDescription>הסכם, תשלומים ובקשת השדרוג של העסק.</SheetDescription>
          </SheetHeader>
          {open?.tenant_id ? (
            <div className="mt-4">
              <BillingAdminCard tenantId={open.tenant_id} onChanged={() => void load()} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
