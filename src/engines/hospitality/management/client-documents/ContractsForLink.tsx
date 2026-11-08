// החוזים של הזמנה / אירוע (בעמוד ההזמנה ובעמוד האירוע): מצב, מתי נשלח / נחתם, ופעולות
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/platform/ui";
import { hospitalityContractsFor } from "../../api/contracts.functions";
import { CONTRACT_KIND_LABEL, CONTRACT_STATUS_LABEL } from "../../types/contracts";
import { errorText } from "../catalog/refresh";
import { formatDateTime } from "../lib/format";
import { ContractActions } from "./ContractActions";
import { CONTRACT_STATUS_TONE, contractsForKey } from "./model";

export function ContractsForLink({
  bookingId = null,
  eventId = null,
}: {
  bookingId?: string | null;
  eventId?: string | null;
}) {
  const q = useQuery({
    queryKey: contractsForKey(bookingId, eventId),
    queryFn: () => hospitalityContractsFor({ data: { bookingId, eventId } }),
  });
  if (q.isError) return <p className="text-sm text-destructive">{errorText(q.error)}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">טוען…</p>;
  if (q.data.length === 0)
    return <p className="text-sm text-muted-foreground">עוד לא נשלח חוזה.</p>;
  return (
    <ul className="flex flex-col gap-3" data-testid="contracts-for-link">
      {q.data.map((c) => (
        <li
          key={c.id}
          className="flex flex-col gap-2 rounded-lg border p-3"
          data-contract={c.number}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              חוזה #{c.number} · {CONTRACT_KIND_LABEL[c.kind]}
            </p>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                CONTRACT_STATUS_TONE[c.status],
              )}
            >
              {CONTRACT_STATUS_LABEL[c.status]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {c.signer_name} · <span dir="ltr">{c.signer_email}</span>
            {c.signed_at
              ? ` · נחתם ${formatDateTime(c.signed_at)}`
              : c.last_sent_at
                ? ` · נשלח ${formatDateTime(c.last_sent_at)}`
                : ""}
          </p>
          {c.send_error && c.stored_status === "draft" && (
            <p className="text-xs text-destructive">השליחה האחרונה נכשלה — החוזה לא נשלח.</p>
          )}
          <ContractActions c={c} compact />
        </li>
      ))}
    </ul>
  );
}
