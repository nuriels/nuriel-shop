// ארכיון החוזים: חיפוש (שם / טלפון / אימייל / מספר) וסינון (סוג חוזה, מצב, סוג אירוע, תאריך השירות),
// טבלה במחשב וכרטיסים בטלפון. בכל שורה: הלקוח, סוג החוזה וההזמנה, תאריך האירוע / השהייה, החתימה,
// המצב, ופעולות (צפייה / הורדה של ה-PDF, עותק שוב, שליחה חוזרת, ביטול, חוזה מתוקן). "פרטים" —
// הנוסח, מה שהלקוח מילא (ת"ז ממוסכת), טביעות ה-sha-256 והיסטוריית החוזה.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
  useIsMobile,
} from "@/platform/ui";
import { hospitalityContractDetail, hospitalityContracts } from "../../api/contracts.functions";
import { ContractBody } from "../../contracts/ContractBody";
import {
  BOOKING_TYPE_LABEL,
  CONTRACT_KIND_LABEL,
  CONTRACT_STATUS_LABEL,
  DEPOSIT_METHOD_LABEL,
  type ContractKind,
  type ContractRow,
  type ContractStatus,
  type ContractsView,
} from "../../types/contracts";
import { EVENT_TYPES, EVENT_TYPE_LABEL } from "../../types/events";
import { errorText } from "../catalog/refresh";
import { formatDateTime } from "../lib/format";
import { EmptyState } from "../ui/kit";
import { ContractActions } from "./ContractActions";
import { CONTRACT_STATUS_TONE, contractKey, contractsListKey, serviceDateText } from "./model";

const PAGE = 30;
const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const STATUSES: ContractStatus[] = [
  "sent",
  "viewed",
  "signed",
  "superseded",
  "expired",
  "draft",
  "cancelled",
];

const LOG_TEXT: Record<string, string> = {
  created: "נוצר",
  link_issued: "נוצר קישור לחתימה",
  sent: "נשלח ללקוח במייל",
  send_failed: "השליחה נכשלה",
  viewed: "הלקוח פתח את החוזה",
  signed: "נחתם",
  pdf_stored: "ה-PDF החתום נשמר",
  copy_sent: "העותק החתום נשלח ללקוח",
  copy_failed: "שליחת העותק נכשלה",
  superseded: "הוחלף בחוזה מתוקן",
  cancelled: "בוטל",
  staff_view: "צפייה ב-PDF (צוות)",
  staff_download: "הורדת ה-PDF (צוות)",
  customer_download: "הלקוח הוריד את ה-PDF",
  signer_updated: "פרטי החותם תוקנו (הקישור הקודם בוטל)",
};
const ACTOR_TEXT = { staff: "צוות", customer: "הלקוח", system: "המערכת" } as const;

function StatusTag({ status }: { status: ContractStatus }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
        CONTRACT_STATUS_TONE[status],
      )}
    >
      {CONTRACT_STATUS_LABEL[status]}
    </span>
  );
}

const serviceText = (c: ContractRow) =>
  `${serviceDateText(c.service_date, c.service_end)}${c.event_purpose ? ` · ${c.event_purpose}` : ""}`;

export function ContractsArchive({ counts }: { counts: ContractsView["counts"] }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ContractKind | "">("");
  const [status, setStatus] = useState<ContractStatus | "">("");
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [q, kind, status, eventType, from, to]);
  const filters = { q, kind, status, eventType, from, to, limit };
  const list = useQuery({
    queryKey: contractsListKey(filters),
    queryFn: () =>
      hospitalityContracts({
        data: {
          q: q || null,
          kind: kind || null,
          status: status || null,
          eventType: eventType || null,
          from: from || null,
          to: to || null,
          limit,
          offset: 0,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(q || kind || status || eventType || from || to);

  return (
    <div className="flex flex-col gap-4" data-testid="contracts-archive">
      <p className="text-sm text-muted-foreground">
        {counts.all} חוזים · {counts.signed} חתומים · {counts.waiting} ממתינים לחתימה
        {counts.draft > 0 ? ` · ${counts.draft} טיוטות (לא נשלחו)` : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="ca-q">חיפוש — שם, טלפון, אימייל או מספר</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="ca-q"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-11 ps-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ca-kind">סוג החוזה</Label>
          <select
            id="ca-kind"
            className={SELECT}
            value={kind}
            onChange={(e) => setKind(e.target.value as ContractKind | "")}
          >
            <option value="">הכל</option>
            <option value="hosting">{CONTRACT_KIND_LABEL.hosting}</option>
            <option value="pool_event">{CONTRACT_KIND_LABEL.pool_event}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ca-status">מצב</Label>
          <select
            id="ca-status"
            className={SELECT}
            value={status}
            onChange={(e) => setStatus(e.target.value as ContractStatus | "")}
          >
            <option value="">הכל</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ca-type">סוג האירוע</Label>
          <select
            id="ca-type"
            className={SELECT}
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="">הכל</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ca-from">תאריך האירוע / השהייה — מ-</Label>
          <Input
            id="ca-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ca-to">עד</Label>
          <Input
            id="ca-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11"
          />
        </div>
      </div>

      {list.isError && !list.data ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(list.error)}
        </p>
      ) : !list.data ? (
        <p className="text-sm text-muted-foreground">טוען את הארכיון…</p>
      ) : list.data.rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={filtered ? "לא נמצאו חוזים" : "עוד אין חוזים בארכיון"}
          text={
            filtered
              ? "נסו חיפוש אחר או נקו את הסינון."
              : "חוזה שנשלח ללקוח לחתימה יופיע כאן, עם המצב וה-PDF החתום."
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {list.data.total} חוזים{filtered ? " תואמים" : ""}
          </p>
          {/* מחשב: טבלה */}
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm" data-testid="contracts-table">
              <caption className="sr-only">ארכיון החוזים</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    הלקוח
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    החוזה
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    תאריך האירוע / השהייה
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    נחתם
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    מצב
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    פעולות
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((c) => (
                  <tr key={c.id} className="border-t align-top" data-contract={c.number}>
                    <td className="px-3 py-3">
                      <p className="font-medium">{c.signer_name}</p>
                      {c.signer_phone && (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {c.signer_phone}
                        </p>
                      )}
                      <p className="text-xs break-all text-muted-foreground" dir="ltr">
                        {c.signer_email}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p>
                        #{c.number} · {CONTRACT_KIND_LABEL[c.kind]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {BOOKING_TYPE_LABEL[c.booking_type]}
                        {c.link_number ? ` #${c.link_number}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">{serviceText(c)}</td>
                    <td className="px-3 py-3">{c.signed_at ? formatDateTime(c.signed_at) : "—"}</td>
                    <td className="px-3 py-3">
                      <StatusTag status={c.status} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-10"
                          onClick={() => setOpenId(c.id)}
                        >
                          פרטים<span className="sr-only"> — חוזה #{c.number}</span>
                        </Button>
                        <ContractActions c={c} compact />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* טלפון: כרטיסים */}
          <ul className="flex flex-col gap-3 md:hidden" data-testid="contracts-cards">
            {list.data.rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4"
                data-contract={c.number}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.signer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      #{c.number} · {CONTRACT_KIND_LABEL[c.kind]}
                    </p>
                  </div>
                  <StatusTag status={c.status} />
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">טלפון</dt>
                  <dd dir="ltr" className="text-start">
                    {c.signer_phone ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">אימייל</dt>
                  <dd dir="ltr" className="text-start break-all">
                    {c.signer_email}
                  </dd>
                  <dt className="text-muted-foreground">{BOOKING_TYPE_LABEL[c.booking_type]}</dt>
                  <dd>
                    {c.link_number ? `#${c.link_number} · ` : ""}
                    {serviceText(c)}
                  </dd>
                  <dt className="text-muted-foreground">נחתם</dt>
                  <dd>{c.signed_at ? formatDateTime(c.signed_at) : "—"}</dd>
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    onClick={() => setOpenId(c.id)}
                  >
                    פרטים<span className="sr-only"> — חוזה #{c.number}</span>
                  </Button>
                  <ContractActions c={c} compact />
                </div>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.rows.length && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 self-center"
              disabled={list.isFetching}
              onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}
            >
              {list.isFetching ? "טוען…" : "עוד חוזים"}
            </Button>
          )}
        </>
      )}
      <ContractDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ContractDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const detail = useQuery({
    queryKey: contractKey(id ?? "none"),
    enabled: id !== null,
    queryFn: () => hospitalityContractDetail({ data: { id: id! } }),
  });
  const d = detail.data && detail.data.id === id ? detail.data : null;
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "left"}
        className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-2xl"
        data-testid="contract-detail"
      >
        <SheetHeader className="ps-10 text-start sm:text-start">
          <SheetTitle>{d ? `חוזה #${d.number}` : "חוזה"}</SheetTitle>
          <SheetDescription>{d ? d.title : "טוען…"}</SheetDescription>
        </SheetHeader>
        {detail.isError && !d ? (
          <p className="mt-4 text-sm text-destructive">{errorText(detail.error)}</p>
        ) : !d ? (
          <p className="mt-4 text-sm text-muted-foreground">טוען…</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag status={d.status} />
              {d.cancel_reason && (
                <span className="text-muted-foreground">סיבה: {d.cancel_reason}</span>
              )}
            </div>
            <ContractActions c={d} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">הלקוח</dt>
              <dd>
                {d.signer_name} · <span dir="ltr">{d.signer_email}</span>
                {d.signer_phone && (
                  <>
                    {" "}
                    · <span dir="ltr">{d.signer_phone}</span>
                  </>
                )}
              </dd>
              <dt className="text-muted-foreground">{BOOKING_TYPE_LABEL[d.booking_type]}</dt>
              <dd>
                {d.booking_id ? (
                  <Link
                    to="/manage/bookings/$bookingId"
                    params={{ bookingId: d.booking_id }}
                    className="underline"
                  >
                    הזמנה #{d.link_number}
                  </Link>
                ) : d.event_id ? (
                  <Link
                    to="/manage/events/$eventId"
                    params={{ eventId: d.event_id }}
                    className="underline"
                  >
                    אירוע #{d.link_number}
                  </Link>
                ) : (
                  "—"
                )}{" "}
                · {serviceText(d)}
              </dd>
              <dt className="text-muted-foreground">גרסת הנוסח</dt>
              <dd>{d.template_version}</dd>
              <dt className="text-muted-foreground">נוצר</dt>
              <dd>{formatDateTime(d.created_at)}</dd>
              {d.last_sent_at && (
                <>
                  <dt className="text-muted-foreground">נשלח</dt>
                  <dd>
                    {formatDateTime(d.last_sent_at)}
                    {d.send_count > 1 ? ` (${d.send_count} פעמים)` : ""}
                    {d.link_expires_at && !d.signed_at
                      ? ` · הקישור תקף עד ${formatDateTime(d.link_expires_at)}`
                      : ""}
                  </dd>
                </>
              )}
              {d.viewed_at && (
                <>
                  <dt className="text-muted-foreground">נפתח</dt>
                  <dd>{formatDateTime(d.viewed_at)}</dd>
                </>
              )}
              {d.signed_at && (
                <>
                  <dt className="text-muted-foreground">נחתם</dt>
                  <dd>
                    {formatDateTime(d.signed_at)} ·{" "}
                    {d.signature_kind === "typed" ? "חתימה בהקלדת השם" : "חתימה בציור"}
                    {d.signer_ip ? (
                      <>
                        {" "}
                        · IP <span dir="ltr">{d.signer_ip}</span>
                      </>
                    ) : null}
                  </dd>
                </>
              )}
              {d.customer_fields && (
                <>
                  <dt className="text-muted-foreground">מה שהלקוח מילא</dt>
                  <dd>
                    ת"ז / ח.פ <span dir="ltr">{d.customer_fields.id_number_masked}</span>
                    {d.customer_fields.address ? ` · ${d.customer_fields.address}` : ""}
                    {d.customer_fields.deposit_method
                      ? ` · פיקדון: ${DEPOSIT_METHOD_LABEL[d.customer_fields.deposit_method]}`
                      : ""}
                  </dd>
                </>
              )}
              {d.signed_at && (
                <>
                  <dt className="text-muted-foreground">העותק ללקוח</dt>
                  <dd>
                    {d.copy_sent_at ? `נשלח ${formatDateTime(d.copy_sent_at)}` : "עוד לא נשלח"}
                    {d.copy_error && !d.copy_sent_at ? " — השליחה נכשלה" : ""}
                  </dd>
                </>
              )}
              {d.signed_body_sha256 && (
                <>
                  <dt className="text-muted-foreground">טביעת הנוסח החתום</dt>
                  <dd className="font-mono text-xs break-all" dir="ltr">
                    sha256 {d.signed_body_sha256}
                  </dd>
                </>
              )}
              {d.pdf_sha256 && (
                <>
                  <dt className="text-muted-foreground">טביעת ה-PDF</dt>
                  <dd className="font-mono text-xs break-all" dir="ltr">
                    sha256 {d.pdf_sha256}
                  </dd>
                </>
              )}
            </dl>
            <details className="rounded-lg border">
              <summary className="min-h-11 cursor-pointer px-4 py-3 font-medium">
                {d.signed_at ? "הנוסח החתום (כפי שנחתם — לא משתנה)" : "הנוסח שנשלח"}
              </summary>
              <div className="border-t bg-white p-4">
                <ContractBody body={d.body} highlightBlanks={!d.signed_at} />
              </div>
            </details>
            <section>
              <h3 className="mb-2 font-bold">היסטוריה</h3>
              <ol className="flex flex-col gap-1.5" data-testid="contract-log">
                {d.log.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 border-b pb-1.5">
                    <span>
                      {LOG_TEXT[l.action] ?? l.action}
                      <span className="text-muted-foreground"> · {ACTOR_TEXT[l.actor_kind]}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(l.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
