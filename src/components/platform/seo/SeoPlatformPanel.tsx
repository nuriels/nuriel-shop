// NURIEL AI SEO ENGINE — the platform admin's overview: numbers per business only (technical score, critical /
// important findings, open proposals, Search Console connected, queued jobs). No proposal texts, no customer
// data, no business content — the owner's SEO center is theirs. Actions: queue an audit / an initial run /
// a Search Console sync for one business (the pilot), connect the platform's own domain property.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getPlatformSeoOverview,
  platformGscConnectLinkFn,
  platformSeoRequestFn,
} from "@/platform/seo/center.functions";

const KEY = ["platform", "seo"] as const;
const TYPE: Record<string, string> = {
  ecommerce: "חנות",
  hospitality: "אירוח",
  business_profile: "אתר עסק",
};
const messageOf = (e: unknown) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : "הפעולה נכשלה — נסו שוב";

export function SeoPlatformPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => getPlatformSeoOverview(), retry: false });
  const [filter, setFilter] = useState("");
  const request = useMutation({
    mutationFn: (v: { tenantId: string; kind: "audit" | "initial" | "gsc_sync" }) =>
      platformSeoRequestFn({ data: v }),
    onSuccess: (r) => {
      toast.success(r.queued ? "נכנס לתור — ירוץ בדקות הקרובות" : "כבר היה בתור — ירוץ עכשיו");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const connect = useMutation({
    mutationFn: () => platformGscConnectLinkFn(),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(messageOf(e)),
  });
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (query.data?.rows ?? []).filter(
      (r) => !f || r.name.toLowerCase().includes(f) || r.slug.includes(f),
    );
  }, [query.data, filter]);

  return (
    <div className="flex flex-col gap-4" dir="rtl" data-testid="seo-platform">
      <Card>
        <CardHeader>
          <CardTitle>SEO — כל העסקים</CardTitle>
          <CardDescription>
            ציון הבדיקה הטכנית (לא תחזית דירוג), ממצאים, הצעות שממתינות לבעלי העסקים, וחיבורי Search
            Console. בלי טקסטים של עסקים ובלי מידע על לקוחות.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="חיפוש עסק…"
            aria-label="חיפוש עסק"
            className="max-w-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void qc.invalidateQueries({ queryKey: KEY })}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            רענון
          </Button>
          {query.data?.gsc_configured ? (
            <Button
              type="button"
              variant="outline"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              חיבור נכס הדומיין של הפלטפורמה ב-Search Console
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              Search Console לא מוגדר בשרת (GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET)
            </span>
          )}
        </CardContent>
      </Card>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">טוענים…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {messageOf(query.error)}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">מצב ה-SEO לפי עסק</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 text-start font-medium">
                  עסק
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  סוג
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  ציון
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  קריטי / חשוב
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  הצעות פתוחות
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  Search Console
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  בתור
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  פעולות
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenant_id} className="border-t" data-testid="seo-platform-row">
                  <td className="p-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {r.slug}
                    </div>
                  </td>
                  <td className="p-2">{TYPE[r.site_type] ?? r.site_type}</td>
                  <td className="p-2 tabular-nums">{r.score ?? "—"}</td>
                  <td className="p-2 tabular-nums">
                    {r.critical} / {r.high}
                  </td>
                  <td className="p-2 tabular-nums">{r.pending}</td>
                  <td className="p-2">{r.gsc ? "מחובר" : "—"}</td>
                  <td className="p-2 tabular-nums">{r.queued}</td>
                  <td className="p-2">
                    {(r.site_type === "ecommerce" || r.site_type === "hospitality") && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={request.isPending}
                          onClick={() => request.mutate({ tenantId: r.tenant_id, kind: "audit" })}
                        >
                          בדיקה
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={request.isPending}
                          onClick={() => request.mutate({ tenantId: r.tenant_id, kind: "initial" })}
                        >
                          <Play className="size-3.5" aria-hidden="true" />
                          הפקה ראשונית
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={request.isPending}
                          onClick={() =>
                            request.mutate({ tenantId: r.tenant_id, kind: "gsc_sync" })
                          }
                        >
                          סנכרון Search Console
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
