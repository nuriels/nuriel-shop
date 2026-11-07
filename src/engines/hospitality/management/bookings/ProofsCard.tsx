// שלב א' 5: "אישורי העברה" בעמוד ההזמנה — האישורים שהאורח העלה (צילום מסך / PDF), צפייה בקובץ
// (קישור חתום קצר מהשרת, רק אחרי בדיקת הרשאה במסד), ואישור (= תשלום ביומן, בסכום שהתקבל) או דחייה
// (עם סיבה שהאורח רואה). כל אישור נבדק פעם אחת — המסד מסרב לבדיקה כפולה.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
  cn,
} from "@/platform/ui";
import {
  hospitalityBookingProofs,
  hospitalityProofUrl,
  hospitalityReviewProof,
} from "../../api/payments.functions";
import { CARD_IN_PAYMENT_NOTE, looksLikeCardNumber } from "../../payments/phone";
import type { PaymentProofView, StaffBookingProofs } from "../../types/payment-instructions";
import { errorText } from "../catalog/refresh";
import { formatDateTime } from "../lib/format";
import { useBookingRefresh } from "./refresh";
import { proofsKey } from "./model";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(Number(n));

const STATUS: Record<PaymentProofView["status"], { text: string; tone: string }> = {
  submitted: { text: "ממתין לבדיקה", tone: "bg-amber-100 text-amber-900" },
  approved: { text: "אושר — נרשם תשלום", tone: "bg-emerald-100 text-emerald-900" },
  rejected: { text: "נדחה", tone: "bg-rose-100 text-rose-900" },
};

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;

export function ProofsCard({ bookingId, timezone }: { bookingId: string; timezone: string }) {
  const qc = useQueryClient();
  const key = proofsKey(bookingId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => hospitalityBookingProofs({ data: { bookingId } }),
  });
  const refresh = useBookingRefresh(bookingId);
  const card = useRef<HTMLDivElement>(null);
  const p = query.data;
  // הכרטיס מוצג רק כשיש מה לראות: האורח בחר העברה בנקאית, או שהועלו אישורים
  const shown = !!p && (p.proofs.length > 0 || p.payment_method === "bank");
  // קישור מלוח הבקרה (#transfer-proofs): הכרטיס נטען אחרי העמוד — גוללים אליו כשהוא מופיע
  useEffect(() => {
    if (shown && window.location.hash === "#transfer-proofs")
      card.current?.scrollIntoView({ block: "start" });
  }, [shown]);
  if (!p || !shown) {
    return query.isError ? (
      <p role="alert" className="text-sm text-destructive">
        {errorText(query.error)}
      </p>
    ) : null;
  }
  const done = (r: StaffBookingProofs) => {
    qc.setQueryData(key, r);
    // אישור = תשלום ביומן: הסכום ששולם, היתרה והמצב משתנים בכל המסכים
    refresh();
  };
  return (
    <Card ref={card} data-section="transfer-proofs" id="transfer-proofs" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-4" aria-hidden="true" />
          אישורי העברה
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {p.payment_method === "bank" && (
          <p className="text-muted-foreground">
            האורח בחר בהעברה בנקאית
            {p.amount_due > 0 ? ` · נשאר לתשלום ${money(p.amount_due, p.currency)}` : ""}
          </p>
        )}
        {p.proofs.length === 0 ? (
          <p className="text-muted-foreground" data-testid="staff-no-proofs">
            עוד לא הועלה אישור העברה.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="staff-proofs">
            {p.proofs.map((proof) => (
              <ProofLine
                key={proof.id}
                proof={proof}
                amountDue={p.amount_due}
                currency={p.currency}
                timezone={timezone}
                onReviewed={done}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          אשרו רק אחרי שבדקתם שההעברה נכנסה לחשבון. אישור רושם תשלום (העברה בנקאית) ביומן התשלומים;
          דחייה שולחת לאורח את הסיבה בעמוד ההזמנה שלו, והוא יכול להעלות אישור אחר.
        </p>
      </CardContent>
    </Card>
  );
}

function ProofLine({
  proof,
  amountDue,
  currency,
  timezone,
  onReviewed,
}: {
  proof: PaymentProofView;
  amountDue: number;
  currency: string;
  timezone: string;
  onReviewed: (r: StaffBookingProofs) => void;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [amount, setAmount] = useState(amountDue > 0 ? String(amountDue) : "");
  const [note, setNote] = useState("");
  const cardInNote = looksLikeCardNumber(note);
  const view = useMutation({
    mutationFn: () => hospitalityProofUrl({ data: { proofId: proof.id } }),
    onError: (e) => toast.error(errorText(e)),
  });
  const review = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      hospitalityReviewProof({
        data: {
          proofId: proof.id,
          decision,
          amount: decision === "approve" ? Number(amount) : undefined,
          note,
        },
      }),
    onSuccess: (r, decision) => {
      toast.success(decision === "approve" ? "ההעברה אושרה והתשלום נרשם" : "האישור נדחה");
      setMode(null);
      onReviewed(r);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const status = STATUS[proof.status];
  const isPdf = proof.mime === "application/pdf";
  const open = async () => {
    // תמונה — בלשונית חדשה (נפתחת מיד, בלחיצה, כדי שהדפדפן לא יחסום); PDF — הורדה בלבד
    const tab = isPdf ? null : window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await view.mutateAsync();
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch {
      tab?.close();
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3" data-proof-status={proof.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium" dir="auto">
          {proof.file_name}
        </span>
        <span
          className={cn("rounded-full px-3 py-1 text-xs font-medium", status.tone)}
          data-testid="staff-proof-status"
        >
          {status.text}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {isPdf ? "PDF" : "תמונה"} · {sizeText(proof.size)} · הועלה{" "}
        {formatDateTime(proof.submitted_at, timezone)}
        {proof.reviewed_at ? ` · נבדק ${formatDateTime(proof.reviewed_at, timezone)}` : ""}
      </p>
      {proof.review_note && (
        <p className="text-xs">
          {proof.status === "rejected" ? "סיבת הדחייה: " : "הערה: "}
          {proof.review_note}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1"
          disabled={view.isPending}
          onClick={() => void open()}
        >
          <Eye className="size-3.5" aria-hidden="true" />
          {isPdf ? "הורדת הקובץ" : "צפייה בקובץ"}
        </Button>
        {proof.status === "submitted" && mode === null && (
          <>
            <Button
              type="button"
              size="sm"
              className="min-h-10 gap-1"
              onClick={() => setMode("approve")}
            >
              <Check className="size-3.5" aria-hidden="true" />
              ההעברה התקבלה
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 gap-1"
              onClick={() => setMode("reject")}
            >
              <X className="size-3.5" aria-hidden="true" />
              דחייה
            </Button>
          </>
        )}
      </div>
      {proof.status === "submitted" && mode !== null && (
        <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3">
          {mode === "approve" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`proof-amount-${proof.id}`}>הסכום שהתקבל (₪)</Label>
              <Input
                id={`proof-amount-${proof.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`proof-note-${proof.id}`}>
              {mode === "reject" ? "למה האישור נדחה (האורח יראה את זה)" : "הערה (לא חובה)"}
            </Label>
            <Textarea
              id={`proof-note-${proof.id}`}
              value={note}
              maxLength={300}
              rows={2}
              aria-invalid={cardInNote}
              aria-describedby={cardInNote ? `proof-note-error-${proof.id}` : undefined}
              onChange={(e) => setNote(e.target.value)}
            />
            {cardInNote && (
              <p
                id={`proof-note-error-${proof.id}`}
                role="alert"
                className="text-xs text-destructive"
              >
                {CARD_IN_PAYMENT_NOTE}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === "reject" ? "destructive" : "default"}
              className="min-h-11"
              disabled={
                review.isPending ||
                cardInNote ||
                (mode === "approve" ? !(Number(amount) > 0) : note.trim().length < 2)
              }
              onClick={() => review.mutate(mode)}
            >
              {mode === "approve" ? "אישור ורישום התשלום" : "דחיית האישור"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={review.isPending}
              onClick={() => setMode(null)}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
