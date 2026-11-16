// אימות כתובת המייל של בעלת האתר (מיגרציה 198) — רק למי שנכנסה דרך הזמנה ועוד לא אימתה. המייל לא מוצג כמאומת עד
// שהקוד שנשלח לתיבה חוזר. בלי שירות מיילים בשרת — מוסבר בבירור, והחשבון ממשיך לעבוד כרגיל.
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button, Input, Label } from "@/platform/ui";
import {
  studioOwnerEmailSendCode,
  studioOwnerEmailStatus,
  studioOwnerEmailVerify,
} from "../api/owner-invite.functions";

const KEY = ["bp", "owner-email"] as const;

export function OwnerEmailBanner() {
  const load = useServerFn(studioOwnerEmailStatus);
  const send = useServerFn(studioOwnerEmailSendCode);
  const verify = useServerFn(studioOwnerEmailVerify);
  const qc = useQueryClient();
  const id = useId();
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: KEY, queryFn: () => load(), retry: false });
  const sendM = useMutation({
    mutationFn: () => send(),
    onSuccess: (r) => {
      setError(null);
      setNote(
        r.status === "sent"
          ? "שלחנו קוד חדש. הוא תקף ל-10 דקות."
          : r.status === "not_configured"
            ? "שליחת מיילים עוד לא הוגדרה בשרת."
            : "השליחה לא הצליחה. נסו שוב בעוד רגע.",
      );
    },
    onError: (e) => setError(e instanceof Error ? e.message : "השליחה נכשלה"),
  });
  const verifyM = useMutation({
    mutationFn: (c: string) => verify({ data: { code: c } }),
    onSuccess: async () => {
      setError(null);
      setNote(null);
      await qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "האימות נכשל"),
  });

  const s = q.data;
  if (!s?.needed) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    verifyM.mutate(code);
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mb-6 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      data-testid="owner-email-banner"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold">
        כתובת המייל עוד לא אומתה
      </h2>
      {s.emailConfigured ? (
        <>
          <p>
            שלחנו קוד בן 6 ספרות אל <bdi dir="ltr">{s.email}</bdi>. הזינו אותו כאן כדי לאמת שהכתובת
            שלכם — כך אפשר לקבל פניות מלקוחות ולאפס סיסמה.
          </p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
            <div className="space-y-1">
              <Label htmlFor={`${id}-code`}>קוד אימות</Label>
              <Input
                id={`${id}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                className="w-32 bg-background"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button type="submit" disabled={code.length !== 6 || verifyM.isPending}>
              {verifyM.isPending ? "בודקים…" : "אימות"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="bg-background"
              disabled={sendM.isPending}
              onClick={() => sendM.mutate()}
            >
              שליחת קוד חדש
            </Button>
          </form>
        </>
      ) : (
        <p>
          הכתובת <bdi dir="ltr">{s.email}</bdi> עוד לא אומתה, כי שליחת מיילים עוד לא הוגדרה בשרת.
          החשבון פעיל ואפשר לעבוד כרגיל; כשהשליחה תוגדר, יופיע כאן קוד לאימות.
        </p>
      )}
      <div aria-live="polite">
        {note && <p>{note}</p>}
        {error && (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
