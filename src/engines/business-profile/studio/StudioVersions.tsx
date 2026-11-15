// "גרסאות": כל הגרסאות שפורסמו (והבקשות), מה באוויר עכשיו, ושחזור — גרסה קודמת חוזרת לטיוטה, ומשם פרסום
// רגיל. שום גרסה לא נמחקת ולא משתנה.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import { studioDraft, studioRestoreVersion, studioVersions } from "../api/studio.functions";
import { DRAFT_QUERY } from "./StudioOverview";
import { useStudio } from "./StudioLayout";
import { formatDate } from "./status";

const STATE_LABEL = {
  pending: "ממתינה לאישור",
  published: "פורסמה",
  rejected: "הוחזרה לתיקון",
} as const;

export function StudioVersions() {
  const { context } = useStudio();
  const qc = useQueryClient();
  const list = useServerFn(studioVersions);
  const loadDraft = useServerFn(studioDraft);
  const restore = useServerFn(studioRestoreVersion);
  const versions = useQuery({ queryKey: ["bp", "versions"], queryFn: () => list() });
  const draft = useQuery({ queryKey: DRAFT_QUERY, queryFn: () => loadDraft() });
  const canRestore = context.permissions.includes("versions.restore");
  const restoreM = useMutation({
    mutationFn: (id: string) => restore({ data: { id, revision: draft.data!.revision } }),
    onSuccess: async () => {
      toast.success("הגרסה הועתקה לטיוטה. כדי שתופיע באתר — פרסמו אותה.");
      await qc.invalidateQueries({ queryKey: DRAFT_QUERY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "השחזור נכשל"),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">גרסאות</h1>
        <p className="mt-1 text-muted-foreground">
          כל פרסום נשמר כגרסה. אפשר להחזיר כל גרסה לטיוטה ולפרסם אותה שוב.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">היסטוריה</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.isPending ? (
            <p className="text-sm text-muted-foreground">טוען…</p>
          ) : !versions.data?.length ? (
            <p className="text-sm text-muted-foreground">
              עוד אין גרסאות. הגרסה הראשונה נוצרת בפרסום הראשון.
            </p>
          ) : (
            <ul className="divide-y">
              {versions.data.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {v.version ? `גרסה ${v.version}` : "בקשת פרסום"}{" "}
                      <Badge variant={v.live ? "default" : "secondary"} className="ms-1">
                        {v.live ? "באוויר" : STATE_LABEL[v.state]}
                      </Badge>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(v.created_at)}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                    {v.review_note && (
                      <p className="text-sm text-amber-900">הערת Nuriel: {v.review_note}</p>
                    )}
                  </div>
                  {canRestore && v.state !== "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!draft.data || restoreM.isPending}
                      onClick={() => restoreM.mutate(v.id)}
                    >
                      שחזור לטיוטה
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
