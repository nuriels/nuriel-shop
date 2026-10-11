import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, Loader2, Puzzle, X } from "lucide-react";
import { toast } from "sonner";
import {
  loadPlatformAddonRequests,
  platformApproveAddon,
  platformRejectAddon,
} from "@/lib/addons.functions";
import type { PlatformAddonRequest } from "@/lib/addons";
import { formatDate, formatShekels } from "@/lib/subscription";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * חלק 38: בקשות לתוספים (מכל החנויות) — בלוח הבקרה של מנהל הפלטפורמה.
 *
 * בעל חנות שלחץ "רכש תוסף" יצר בקשה "ממתינה לתשלום / לאישור" — התוסף לא
 * פעיל. מנהל הפלטפורמה יוצר קשר, גובה מחוץ למערכת (קישור אשראי / ביט), ורק
 * אחרי שהתשלום התקבל לוחץ "אשר תשלום והפעל תוסף" — רק אז התוסף נפתח בחנות.
 */
export function AddonRequestsPanel() {
  const load = useServerFn(loadPlatformAddonRequests);
  const approve = useServerFn(platformApproveAddon);
  const reject = useServerFn(platformRejectAddon);
  const [rows, setRows] = useState<PlatformAddonRequest[] | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await load());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת הבקשות לתוספים נכשלה");
      setRows([]);
    }
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפעולה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const pending = (rows ?? []).filter((row) => row.status === "pending");
  const decided = (rows ?? []).filter((row) => row.status !== "pending");

  return (
    <section
      className="space-y-3"
      aria-labelledby="addon-requests-title"
      data-testid="addon-requests"
    >
      <div>
        <h2 id="addon-requests-title" className="flex items-center gap-2 text-xl font-bold">
          <Puzzle className="size-5" aria-hidden="true" />
          בקשות לתוספים
          {pending.length > 0 && (
            <span className="numeric rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              {pending.length}
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          התוסף לא פעיל עד האישור. צרו קשר עם בעל החנות ושלחו קישור לתשלום (אשראי או ביט), ואחרי
          שהתשלום התקבל — "אשר תשלום והפעל תוסף".
        </p>
      </div>

      {rows === null ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען בקשות לתוספים…
        </p>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            אין בקשות לתוספים שממתינות לאישור
          </CardContent>
        </Card>
      ) : (
        pending.map((r) => (
          <Card key={r.id} data-addon-request={r.addon} className="border-amber-300">
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">
                    {r.title} · <span className="numeric">{formatShekels(r.amount)}</span>
                  </p>
                  <p className="text-sm font-medium">{r.tenantName}</p>
                  <p dir="ltr" className="text-left text-xs text-muted-foreground">
                    {r.tenantSlug}
                    {r.requestedByEmail || r.ownerEmail
                      ? ` · ${r.requestedByEmail ?? r.ownerEmail}`
                      : ""}
                  </p>
                </div>
                <Badge>ממתין לתשלום / לאישור</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {r.billing === "monthly" ? "חודשי (חיוב יחסי עד סוף תקופת המנוי)" : "חד-פעמי"} ·
                נשלחה {formatDate(r.requestedAt)}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`ref-${r.id}`}>אסמכתת תשלום (לא חובה)</Label>
                <Input
                  id={`ref-${r.id}`}
                  maxLength={120}
                  placeholder="למשל: ביט 4411 / אשראי — מס' אישור"
                  value={refs[r.id] ?? ""}
                  onChange={(event) =>
                    setRefs((current) => ({ ...current, [r.id]: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy === r.id}
                  data-testid={`approve-addon-${r.id}`}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `לאשר שהתשלום (${formatShekels(r.amount)}) התקבל ולהפעיל את "${r.title}" ב"${r.tenantName}"?`,
                      )
                    )
                      return;
                    void act(
                      r.id,
                      () =>
                        approve({
                          data: {
                            requestId: r.id,
                            tenantId: r.tenantId,
                            reference: refs[r.id] ?? "",
                          },
                        }),
                      `התוסף "${r.title}" הופעל ב"${r.tenantName}"`,
                    );
                  }}
                >
                  {busy === r.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CircleCheck className="size-4" aria-hidden="true" />
                  )}
                  אשר תשלום והפעל תוסף
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy === r.id}
                  onClick={() => {
                    if (!window.confirm(`לדחות את הבקשה ל"${r.title}"? החיוב הממתין יימחק.`))
                      return;
                    void act(r.id, () => reject({ data: { requestId: r.id } }), "הבקשה נדחתה");
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                  דחיית הבקשה
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {decided.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            טופלו ב-30 הימים האחרונים ({decided.length})
          </summary>
          <ul className="mt-2 divide-y">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {r.title} · {r.tenantName}
                </span>
                <span className="text-muted-foreground">
                  {r.rejected
                    ? "נדחתה"
                    : `אושר ${r.approvedAt ? formatDate(r.approvedAt) : ""}${r.approvedReference ? ` · ${r.approvedReference}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
