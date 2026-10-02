import { useEffect, useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PickingStats } from "@/components/PickingStats";
import { fetchPickingLeaderboard, type PickingLeader } from "@/lib/picking";

/** ביצועי עובדי מחסן: כמה הזמנות ליקט כל אחד (החודש / חודש שעבר / סה"כ), ולחיצה פותחת גרפים */
export function WarehousePerformance() {
  const [rows, setRows] = useState<PickingLeader[] | null>(null);
  const [selected, setSelected] = useState<PickingLeader | null>(null);

  useEffect(() => {
    fetchPickingLeaderboard()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheck className="size-4 text-primary" /> עובדי מחסן — ליקוטים
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> טוען...
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            אין עדיין עובדי מחסן. יוצרים אחד ב"משתמשים" → "משתמש צוות חדש" → סוג: מחסנאי.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-right text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 pe-3 font-medium">עובד</th>
                  <th className="pb-2 pe-3 font-medium">החודש</th>
                  <th className="pb-2 pe-3 font-medium">חודש שעבר</th>
                  <th className="pb-2 pe-3 font-medium">סה"כ</th>
                  <th className="pb-2 pe-3 font-medium">בליקוט עכשיו</th>
                  <th className="pb-2 pe-3 font-medium">ליקוט אחרון</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id} className="border-t border-border">
                    <td className="py-2 pe-3 font-semibold text-foreground">
                      {row.name} {row.is_blocked && <Badge variant="destructive">חסום</Badge>}
                    </td>
                    <td className="numeric py-2 pe-3 text-lg font-bold">{row.this_month}</td>
                    <td className="numeric py-2 pe-3">{row.last_month}</td>
                    <td className="numeric py-2 pe-3">{row.total}</td>
                    <td className="numeric py-2 pe-3">{row.in_progress}</td>
                    <td className="py-2 pe-3 text-muted-foreground">
                      {row.last_picked_at
                        ? new Date(row.last_picked_at).toLocaleDateString("he-IL")
                        : "—"}
                    </td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant={selected?.user_id === row.user_id ? "default" : "outline"}
                        onClick={() => setSelected(selected?.user_id === row.user_id ? null : row)}
                      >
                        גרפים
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected && (
          <PickingStats userId={selected.user_id} title={`הליקוטים של ${selected.name}`} />
        )}
      </CardContent>
    </Card>
  );
}
