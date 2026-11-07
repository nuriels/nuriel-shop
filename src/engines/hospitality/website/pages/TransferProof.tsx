// שלב א' 5: העברה בנקאית בעמוד ההזמנה של האורח — מצב ההעברה, העלאת אישור (צילום מסך / PDF) והאישורים
// שנשלחו. הכול מהשרת (guest_payment_info): רענון, סגירת הדפדפן או חזרה מאוחרת מציגים בדיוק את אותו מצב
// ואת אותה אפשרות להעלות. הקובץ נבדק בשרת לפי התוכן ונשמר באחסון פרטי.
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, Upload, XCircle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/platform/ui";
import type { GuestPaymentInfo, PaymentProofView } from "../../types/payment-instructions";
import { useCopy } from "../copy";
import { dateTimeText } from "../lib/format";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
const MAX_PROOFS = 5;

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : fallback;

const TONE: Record<PaymentProofView["status"], string> = {
  submitted: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
};

function StatusIcon({ status }: { status: PaymentProofView["status"] }) {
  const cls = "size-4 shrink-0";
  if (status === "approved") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (status === "rejected") return <XCircle className={cls} aria-hidden="true" />;
  return <Clock className={cls} aria-hidden="true" />;
}

export function TransferCard({
  payment,
  send,
  onSent,
  timeZone,
}: {
  payment: GuestPaymentInfo;
  /** שולח את הקובץ לשרת (בקישור האישי או מהאזור האישי) — מחזיר את מצב התשלום המעודכן */
  send: (file: File) => Promise<GuestPaymentInfo>;
  /** המצב המעודכן מהשרת אחרי ההעלאה — העמוד מעדכן את הנתונים שלו */
  onSent: (info: GuestPaymentInfo) => void;
  timeZone: string;
}) {
  const t = useCopy();
  const tr = payment.transfer;
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState(false);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t.my.transfer.fileHint);
      return send(file);
    },
    onSuccess: (info) => {
      onSent(info);
      setFile(null);
      setDone(true);
      if (input.current) input.current.value = "";
    },
  });
  if (!tr?.allowed) return null;
  const waitingApproval = payment.reason === "not_confirmed" && tr.chosen;
  if (!tr.can_upload && tr.proofs.length === 0 && !waitingApproval) return null;
  const atLimit = !tr.can_upload && payment.available && tr.proofs.length >= MAX_PROOFS;
  return (
    <section
      className="rounded-[var(--radius)] border border-border bg-card p-6 md:col-span-2"
      data-testid="guest-transfer"
    >
      <h2 className="mb-2 flex items-center gap-2 font-medium">
        <FileText className="size-4" aria-hidden="true" />
        {t.my.transfer.title}
      </h2>
      {waitingApproval && (
        <p className="text-sm text-muted-foreground">{t.my.transfer.afterApproval}</p>
      )}
      {tr.can_upload && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(false);
            upload.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t.my.transfer.intro}</p>
          <label className="block text-sm font-medium">
            {t.my.transfer.fileLabel}
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              aria-describedby={hintId}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setDone(false);
                upload.reset();
              }}
              className="mt-1.5 block w-full text-sm file:me-3 file:min-h-11 file:rounded-sm file:border-0 file:bg-[var(--primary)] file:px-4 file:text-[var(--primary-foreground)]"
            />
          </label>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t.my.transfer.fileHint}
          </p>
          <button
            type="submit"
            disabled={!file || upload.isPending}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60"
          >
            <Upload className="size-4" aria-hidden="true" />
            {upload.isPending ? t.my.transfer.uploading : t.my.transfer.upload}
          </button>
          {upload.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errText(upload.error, t.my.transfer.fileHint)}
            </p>
          )}
        </form>
      )}
      {done && (
        <p role="status" className="mt-3 text-sm font-medium" data-testid="transfer-uploaded">
          {t.my.transfer.uploaded}
        </p>
      )}
      {atLimit && <p className="mt-3 text-sm text-muted-foreground">{t.my.transfer.limit}</p>}
      {tr.proofs.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium">{t.my.transfer.sent}</h3>
          <ul className="space-y-2" data-testid="transfer-proofs">
            {tr.proofs.map((p) => (
              <li key={p.id} className="rounded-sm border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate" dir="auto">
                    {p.file_name}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                      TONE[p.status],
                    )}
                  >
                    <StatusIcon status={p.status} />
                    {t.my.transfer.statuses[p.status] ?? p.status}
                  </span>
                </div>
                {p.submitted_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateTimeText(p.submitted_at, timeZone, t.locale)}
                  </p>
                )}
                {p.status === "rejected" && p.review_note && (
                  <p className="mt-1 text-xs">
                    {t.my.transfer.rejectedNote(p.review_note)}
                    {tr.can_upload ? ` ${t.my.transfer.again}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
