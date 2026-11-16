// "הזמנת בעלת האתר" בתיק האתר (מיגרציה 198): קישור חד-פעמי לפתיחת חשבון — כשעוד אין לנו את המייל שלה. הקישור
// מוצג פעם אחת (במסד רק ה-hash), עם כפתור העתקה לשליחה ידנית בוואטסאפ. יצירה חדשה מבטלת את הקודם; אפשר לבטל.
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/platform/ui";
import {
  websitesPlatformInviteCreate,
  websitesPlatformInviteRevoke,
  websitesPlatformInviteState,
} from "../api/platform-admin.functions";
import { formatDate } from "../studio/status";
import type { CreatedInvite, InviteStatus } from "../types";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

const STATUS_LABEL: Record<InviteStatus, string> = {
  valid: "פעיל",
  invalid: "לא תקין",
  expired: "פג תוקף",
  used: "נוצל — החשבון נפתח",
  revoked: "בוטל",
  owner_exists: "לאתר יש בעלים",
};

export function OwnerInviteCard({ tenantId }: { tenantId: string }) {
  const load = useServerFn(websitesPlatformInviteState);
  const create = useServerFn(websitesPlatformInviteCreate);
  const revoke = useServerFn(websitesPlatformInviteRevoke);
  const qc = useQueryClient();
  const id = useId();
  const key = ["bp", "owner-invite", tenantId];
  const q = useQuery({ queryKey: key, queryFn: () => load({ data: { tenantId } }) });
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);

  const createM = useMutation({
    mutationFn: () => create({ data: { tenantId } }),
    onSuccess: async (r) => {
      setCreated(r);
      toast.success("נוצר קישור הזמנה — תקף ל-72 שעות");
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const revokeM = useMutation({
    mutationFn: () => revoke({ data: { tenantId } }),
    onSuccess: async () => {
      setCreated(null);
      toast.success("הקישור בוטל — הוא כבר לא יעבוד");
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("הקישור הועתק");
    } catch {
      const el = document.getElementById(`${id}-link`) as HTMLInputElement | null;
      el?.select();
      toast.message("סמנו והעתיקו את הקישור (Ctrl+C)");
    }
  }

  const s = q.data;
  return (
    <Card data-testid="owner-invite-card">
      <CardHeader>
        <CardTitle className="text-lg">הזמנת בעלת האתר</CardTitle>
        <CardDescription>
          קישור חד-פעמי לפתיחת חשבון — כשעוד אין לנו את כתובת המייל. בפתיחת הקישור היא בוחרת אימייל
          וסיסמה ונכנסת לממשק הניהול כבעלת האתר הזה בלבד (לא אתרים אחרים, לא הרשאות פלטפורמה). תקף
          72 שעות; נשלח ידנית (למשל בוואטסאפ).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!s ? (
          <p className="text-muted-foreground" role="status">
            {q.isError ? errorText(q.error) : "טוען…"}
          </p>
        ) : s.has_owner ? (
          <div className="space-y-1">
            <p>
              לאתר יש בעלת אתר: <bdi dir="ltr">{s.owner_email}</bdi> — אין צורך בהזמנה.
            </p>
            {s.owner_via_invite && (
              <p className="text-muted-foreground" data-testid="owner-email-verification">
                {s.owner_email_verified_at
                  ? `המייל אומת (${formatDate(s.owner_email_verified_at)}).`
                  : s.emailConfigured
                    ? "המייל עוד לא אומת — נשלח לה קוד אימות, והיא מתבקשת להזין אותו בממשק הניהול."
                    : "המייל עוד לא אומת: שליחת מיילים לא מוגדרת בשרת. החשבון פעיל; האימות יושלם כשהשליחה תוגדר."}
              </p>
            )}
          </div>
        ) : (
          <>
            {!s.emailConfigured && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                שליחת מיילים לא מוגדרת בשרת: החשבון ייפתח כרגיל, אבל אימות כתובת המייל יחכה עד
                שהשליחה תוגדר (המייל לא יוצג כמאומת עד אז).
              </p>
            )}

            {created && (
              <div
                className="space-y-2 rounded-md border bg-muted/40 p-3"
                data-testid="invite-link-box"
              >
                <Label htmlFor={`${id}-link`}>הקישור (מוצג פעם אחת בלבד — לא נשמר במערכת)</Label>
                <Input
                  id={`${id}-link`}
                  readOnly
                  dir="ltr"
                  value={created.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void copy(created.url)}>
                    העתקת הקישור
                  </Button>
                  <Button asChild variant="outline">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        `הקישור לפתיחת החשבון לניהול האתר שלך (תקף ל-72 שעות): ${created.url}`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      פתיחה בוואטסאפ (בוחרים למי לשלוח)
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  בתוקף עד {formatDate(created.expiresAt)}. אחרי שימוש אחד הקישור ננעל.
                </p>
              </div>
            )}

            {s.open ? (
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={s.open.expired ? "secondary" : "default"}>
                  {s.open.expired ? "פג תוקף" : "קישור פעיל"}
                </Badge>
                <span>
                  {s.open.expired ? "פג ב-" : "בתוקף עד "}
                  {formatDate(s.open.expires_at)} · נוצר {formatDate(s.open.created_at)}
                  {s.open.created_by ? ` ע"י ${s.open.created_by}` : ""}
                </span>
              </p>
            ) : (
              !created && <p className="text-muted-foreground">אין קישור פעיל.</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant={s.open ? "outline" : "default"}
                disabled={createM.isPending}
                onClick={() => (s.open ? setConfirm("replace") : createM.mutate())}
              >
                {s.open ? "יצירת קישור חדש (הקודם יבוטל)" : "יצירת קישור להזמנת לקוחה"}
              </Button>
              {s.open && (
                <Button
                  variant="ghost"
                  disabled={revokeM.isPending}
                  onClick={() => setConfirm("revoke")}
                >
                  ביטול הקישור
                </Button>
              )}
            </div>
          </>
        )}

        {s && s.history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">היסטוריית הקישורים</summary>
            <ul className="mt-2 space-y-1" data-testid="invite-history">
              {s.history.map((h) => (
                <li key={h.id}>
                  נוצר {formatDate(h.created_at)} — {STATUS_LABEL[h.status]}
                  {h.status === "revoked" && h.revoke_reason === "replaced" ? " (הוחלף בחדש)" : ""}
                  {h.used_at && (
                    <>
                      {" "}
                      ב-{formatDate(h.used_at)}, <bdi dir="ltr">{h.used_email}</bdi>
                      {h.email_verified_at ? " · המייל אומת" : " · המייל לא אומת"}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm === "revoke" ? "לבטל את קישור ההזמנה?" : "ליצור קישור חדש?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "revoke"
                  ? "הקישור שנשלח יפסיק לעבוד מיד. אפשר ליצור קישור חדש בכל רגע."
                  : "הקישור הקודם יפסיק לעבוד מיד, ויוצג קישור חדש לשליחה."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>חזרה</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirm === "revoke") revokeM.mutate();
                  else createM.mutate();
                  setConfirm(null);
                }}
              >
                {confirm === "revoke" ? "ביטול הקישור" : "יצירת קישור חדש"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
