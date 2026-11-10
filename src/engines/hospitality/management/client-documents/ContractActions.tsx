// פעולות על חוזה / מסמך (בארכיון, ב"מסמכים חתומים" ובכרטיס של הזמנה / אירוע): צפייה / הורדה של ה-PDF
// החתום, שליחת עותק שוב (המסמך לא משתנה), שליחה חוזרת של קישור במייל (לא נחתם), קישור חדש להעתקה
// (מסמך שהלקוח ממלא), ביטול, וחוזה מתוקן (חוזה של הזמנה / אירוע שנחתם — הקודם נשאר עד שהמתוקן נחתם)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ban, Download, Eye, FilePen, Link2, Mail, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/platform/ui";
import {
  hospitalityContractCancel,
  hospitalityContractCopy,
  hospitalityContractFile,
  hospitalityContractResend,
  hospitalityContractShareLink,
} from "../../api/contracts.functions";
import type { ContractRow, StandaloneResult } from "../../types/contracts";
import { errorText } from "../catalog/refresh";
import { CONTRACTS_KEY } from "./model";
import { SignLinkBox } from "./SignLinkBox";

export function ContractActions({ c, compact = false }: { c: ContractRow; compact?: boolean }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: CONTRACTS_KEY });
  const file = useMutation({
    mutationFn: (purpose: "view" | "download") =>
      hospitalityContractFile({ data: { id: c.id, purpose } }),
    onError: (e) => toast.error(errorText(e)),
  });
  // צפייה: הלשונית נפתחת כבר בלחיצה (אחרת הדפדפן חוסם חלון שנפתח אחרי המתנה), והכתובת — קישור ל-60
  // שניות — מגיעה אחריה. הורדה: הקובץ יורד בלי לעזוב את העמוד
  const openFile = (purpose: "view" | "download") => {
    const w = purpose === "view" ? window.open("", "_blank") : null;
    file.mutate(purpose, {
      onSuccess: (r) => {
        if (w) {
          w.opener = null;
          w.location.href = r.url;
        } else window.location.assign(r.url);
      },
      onError: () => w?.close(),
    });
  };
  const copy = useMutation({
    mutationFn: () => hospitalityContractCopy({ data: { id: c.id } }),
    onSuccess: (r) => {
      if (r.sent) toast.success(`העותק החתום נשלח ל-${c.signer_email}`);
      else toast.error("שליחת העותק נכשלה — נסו שוב");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const resend = useMutation({
    mutationFn: () => hospitalityContractResend({ data: { id: c.id } }),
    onSuccess: (r) => {
      if (r.sent) toast.success(`קישור חדש נשלח ל-${c.signer_email} (הקישור הקודם בוטל)`);
      else toast.error(r.error ?? "השליחה נכשלה");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const [shared, setShared] = useState<StandaloneResult | null>(null);
  const share = useMutation({
    mutationFn: () => hospitalityContractShareLink({ data: { id: c.id } }),
    onSuccess: (r) => {
      setShared(r);
      toast.success("נוצר קישור חדש — הקישור הקודם בוטל");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const cancel = useMutation({
    mutationFn: () => hospitalityContractCancel({ data: { id: c.id, reason: null } }),
    onSuccess: () => {
      toast.success("החוזה בוטל — הקישור לא יעבוד יותר");
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const size = compact ? "sm" : "default";
  const btn = "min-h-10 gap-1.5";
  const signed = c.stored_status === "signed" || c.stored_status === "superseded";
  const open =
    c.stored_status === "draft" || c.stored_status === "sent" || c.stored_status === "viewed";
  // חוזה פתוח שכבר לא מתאים להזמנה / לאירוע (או מסמך עצמאי שפרטי העסק / גרסת המסמך השתנו בו):
  // הלקוח לא יוכל לחתום, והמסד לא ישלח אותו שוב
  const stale = open ? c.stale : null;
  const standalone = c.origin === "standalone";
  const customerFills = standalone && c.fill_mode === "customer";
  const sendSearch = c.booking_id
    ? { tab: "send" as const, booking: c.booking_id }
    : c.event_id
      ? { tab: "send" as const, event: c.event_id }
      : { tab: "send" as const };
  return (
    <div className="flex flex-col gap-2">
      {stale && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950"
          data-testid={`contract-stale-${c.number}`}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {standalone
              ? stale === "changed"
                ? "פרטי העסק / התנאים / גרסת המסמך השתנו מאז שהמסמך נוצר — הלקוח לא יוכל לחתום עליו. בטלו אותו וצרו מסמך חדש."
                : "המסמך כבר לא בתוקף (חסרים פרטים, או שהמסמך הוסר מהאתר) — הלקוח לא יוכל לחתום. אפשר לבטל אותו."
              : stale === "changed"
                ? "פרטי ההזמנה / האירוע השתנו מאז שהחוזה נשלח — הלקוח לא יוכל לחתום עליו. שלחו חוזה מעודכן."
                : "ההזמנה / האירוע בוטלו — הלקוח לא יוכל לחתום על החוזה הזה. אפשר לבטל אותו."}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" data-testid={`contract-actions-${c.number}`}>
        {signed && c.has_pdf && (
          <>
            <Button
              type="button"
              size={size}
              variant="outline"
              className={btn}
              disabled={file.isPending}
              onClick={() => openFile("view")}
            >
              <Eye className="size-4" aria-hidden="true" />
              צפייה ב-PDF
            </Button>
            <Button
              type="button"
              size={size}
              variant="outline"
              className={btn}
              disabled={file.isPending}
              onClick={() => openFile("download")}
            >
              <Download className="size-4" aria-hidden="true" />
              הורדה
            </Button>
            <Button
              type="button"
              size={size}
              variant="ghost"
              className={btn}
              disabled={copy.isPending}
              onClick={() => copy.mutate()}
            >
              <Mail className="size-4" aria-hidden="true" />
              שליחת עותק שוב
            </Button>
          </>
        )}
        {!standalone && (c.stored_status === "signed" || stale === "changed") && (
          <Link
            to="/manage/client-documents"
            search={sendSearch}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-muted"
          >
            <FilePen className="size-4" aria-hidden="true" />
            {c.stored_status === "signed" ? "חוזה מתוקן" : "חוזה מעודכן"}
          </Link>
        )}
        {open && (
          <>
            {!stale && c.signer_email && (
              <Button
                type="button"
                size={size}
                variant="outline"
                className={btn}
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
              >
                <Send className="size-4" aria-hidden="true" />
                {c.stored_status === "draft" ? "שליחה במייל" : "שליחה חוזרת במייל"}
              </Button>
            )}
            {!stale && customerFills && (
              <Button
                type="button"
                size={size}
                variant="outline"
                className={btn}
                disabled={share.isPending}
                onClick={() => share.mutate()}
                data-testid={`contract-share-${c.number}`}
              >
                <Link2 className="size-4" aria-hidden="true" />
                קישור חדש להעתקה
              </Button>
            )}
            <Button
              type="button"
              size={size}
              variant="ghost"
              className={btn}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <Ban className="size-4" aria-hidden="true" />
              ביטול
            </Button>
          </>
        )}
      </div>
      {shared?.link && (
        <SignLinkBox
          url={shared.link.url}
          expiresAt={shared.link.expires_at}
          title={c.title}
          phone={c.signer_phone}
          number={c.number}
        />
      )}
    </div>
  );
}
