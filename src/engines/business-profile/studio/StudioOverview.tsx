// "סקירה ופרסום": מצב האתר, הפרסום (לפני האישור הראשון — בקשה למנהל הפלטפורמה; אחריו — פרסום מיידי),
// ביטול בקשה, והערת הדחייה האחרונה. כל פעולה נבדקת שוב במסד (הרשאה, revision של הטיוטה).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Textarea,
} from "@/platform/ui";
import { studioCancelPublishRequest, studioDraft, studioPublish } from "../api/studio.functions";
import { STUDIO_QUERY, useStudio } from "./StudioLayout";
import { formatDate, STATUS_LABEL } from "./status";

export const DRAFT_QUERY = ["bp", "draft"] as const;

export function StudioOverview() {
  const { context, refresh } = useStudio();
  const qc = useQueryClient();
  const loadDraft = useServerFn(studioDraft);
  const publish = useServerFn(studioPublish);
  const cancel = useServerFn(studioCancelPublishRequest);
  const draft = useQuery({ queryKey: DRAFT_QUERY, queryFn: () => loadDraft() });
  const [note, setNote] = useState("");
  const state = context.state;
  const canPublish = context.permissions.includes("site.publish");

  const publishM = useMutation({
    mutationFn: () => publish({ data: { revision: draft.data!.revision, note } }),
    onSuccess: async (r) => {
      setNote("");
      toast.success(
        r.mode === "pending_review"
          ? "הבקשה נשלחה. האתר יתפרסם אחרי אישור של Nuriel."
          : `פורסמה גרסה ${r.version}. האתר מעודכן.`,
      );
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["bp", "versions"] })]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "הפרסום נכשל"),
  });
  const cancelM = useMutation({
    mutationFn: () => cancel(),
    onSuccess: async () => {
      toast.success("בקשת הפרסום בוטלה");
      await refresh();
      await qc.invalidateQueries({ queryKey: STUDIO_QUERY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "הביטול נכשל"),
  });

  const firstPublish = !state.approved;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">סקירה ופרסום</h1>
        <p className="mt-1 text-muted-foreground">
          כל השינויים נשמרים בטיוטה. האתר שהגולשים רואים משתנה רק בפרסום.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>מצב האתר: {STATUS_LABEL[state.status]}</CardTitle>
          <CardDescription>
            {state.status === "live" && state.live_version
              ? `גרסה ${state.live_version} באוויר מאז ${formatDate(state.live_published_at)}`
              : state.status === "pending_review"
                ? `הבקשה נשלחה ב-${formatDate(state.pending?.requested_at)}. Nuriel בודקים את האתר לפני הפרסום הראשון.`
                : "האתר עוד לא פורסם. הפרסום הראשון של כל אתר עובר אישור של Nuriel."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.last_rejection && state.status === "draft" && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              role="note"
            >
              <p className="font-semibold">
                הבקשה הקודמת הוחזרה לתיקון ({formatDate(state.last_rejection.at)}):
              </p>
              <p className="mt-1 whitespace-pre-line">{state.last_rejection.note}</p>
            </div>
          )}
          {state.status === "live" && !state.public_enabled && (
            <p className="rounded-md bg-muted p-3 text-sm">
              האתר מוסתר כרגע מהגולשים. לפרטים — פנו לתמיכה של Nuriel.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            הטיוטה עודכנה לאחרונה: {draft.data ? formatDate(draft.data.updatedAt) : "…"}.{" "}
            <Link
              to="/studio/editor"
              className="font-medium text-foreground underline underline-offset-4"
            >
              לעריכה ולתצוגה המקדימה
            </Link>
          </p>
          {canPublish && state.status !== "pending_review" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.data) publishM.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="bp-publish-note">הערה לגרסה (לא חובה)</Label>
                <Textarea
                  id="bp-publish-note"
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={firstPublish ? "למשל: מוכן לבדיקה" : "למשל: עדכון השירותים"}
                />
              </div>
              <Button type="submit" disabled={!draft.data || publishM.isPending}>
                {publishM.isPending
                  ? "שולח…"
                  : firstPublish
                    ? "שליחה לאישור פרסום"
                    : "פרסום הטיוטה"}
              </Button>
            </form>
          )}
          {canPublish && state.status === "pending_review" && (
            <Button variant="outline" onClick={() => cancelM.mutate()} disabled={cancelM.isPending}>
              ביטול הבקשה (חזרה לעריכה)
            </Button>
          )}
          {!canPublish && <p className="text-sm text-muted-foreground">פרסום — רק בעל העסק.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
