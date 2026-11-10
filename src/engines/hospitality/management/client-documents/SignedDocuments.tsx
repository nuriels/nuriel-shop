// "מסמכים חתומים": כל מה שנחתם — חוזים של הזמנות ואירועים, ומסמכים עצמאיים (חוזים ומסמכי מדיניות).
// חיפוש לפי לקוח / אימייל / טלפון / מספר / שם המסמך, סינון לפי סוג, מקור ותאריך החתימה. בכל מסמך: צפייה
// והורדה של ה-PDF החתום (קישור ל-60 שניות), שליחת העותק שוב ללקוח (המסמך לא משתנה), ופרטים (הנוסח
// החתום, הטביעות וההיסטוריה). חתימה חדשה מסומנת "חדש" עד שמישהו מהצוות פותח את הלשונית — אז היא
// מסומנת "נצפה" (ההתראה בניווט נעלמת).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileSignature, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Label, cn } from "@/platform/ui";
import {
  hospitalityContractsMarkSeen,
  hospitalitySignedDocuments,
} from "../../api/contracts.functions";
import {
  CONTRACT_KIND_LABEL,
  ORIGIN_LABEL,
  type ContractKind,
  type ContractOrigin,
  type ContractRow,
} from "../../types/contracts";
import { errorText } from "../catalog/refresh";
import { formatDateTime } from "../lib/format";
import { EmptyState } from "../ui/kit";
import { ContractActions } from "./ContractActions";
import { ContractDetailSheet, StatusTag } from "./ContractsArchive";
import {
  CONTRACTS_KEY,
  SELECT,
  contractsUnseenKey,
  linkText,
  serviceText,
  signedListKey,
  signerText,
} from "./model";

const PAGE = 30;

function NewTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-950">
      <BellRing className="size-3" aria-hidden="true" />
      חדש
    </span>
  );
}

const docName = (c: ContractRow) => (c.kind === "policy" ? c.title : CONTRACT_KIND_LABEL[c.kind]);

export function SignedDocuments() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ContractKind | "">("");
  const [origin, setOrigin] = useState<ContractOrigin | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [q, kind, origin, from, to]);
  const rangeBad = Boolean(from && to && to < from);
  const filters = { q, kind, origin, from, to, limit };
  const list = useQuery({
    queryKey: signedListKey(filters),
    enabled: !rangeBad,
    queryFn: () =>
      hospitalitySignedDocuments({
        data: {
          q: q || null,
          kind: kind || null,
          origin: origin || null,
          from: from || null,
          to: to || null,
          limit,
          offset: 0,
        },
      }),
    placeholderData: keepPreviousData,
  });
  // נפתחה הלשונית — מה שנחתם עד עכשיו "נצפה" (ה"חדש" נשאר מסומן בשורות עד הרענון הבא)
  const marked = useRef(false);
  const seen = useMutation({
    mutationFn: () => hospitalityContractsMarkSeen({ data: { ids: null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractsUnseenKey });
      void qc.invalidateQueries({ queryKey: [...CONTRACTS_KEY, "view"] });
    },
  });
  const unseen = list.data?.unseen ?? 0;
  useEffect(() => {
    if (!marked.current && unseen > 0) {
      marked.current = true;
      seen.mutate();
    }
  }, [unseen, seen]);
  const filtered = Boolean(q || kind || origin || from || to);

  return (
    <div className="flex flex-col gap-4" data-testid="signed-documents">
      {unseen > 0 && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"
          data-testid="signed-new"
        >
          <BellRing className="size-4" aria-hidden="true" />
          {unseen === 1
            ? "מסמך אחד נחתם מאז הביקור הקודם"
            : `${unseen} מסמכים נחתמו מאז הביקור הקודם`}{" "}
          — מסומנים "חדש".
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="sg-q">חיפוש — שם הלקוח, אימייל, טלפון, מספר או שם המסמך</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="sg-q"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-11 ps-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sg-kind">סוג המסמך</Label>
          <select
            id="sg-kind"
            className={SELECT}
            value={kind}
            onChange={(e) => setKind(e.target.value as ContractKind | "")}
          >
            <option value="">הכל</option>
            <option value="hosting">{CONTRACT_KIND_LABEL.hosting}</option>
            <option value="pool_event">{CONTRACT_KIND_LABEL.pool_event}</option>
            <option value="policy">{CONTRACT_KIND_LABEL.policy}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sg-origin">מקור</Label>
          <select
            id="sg-origin"
            className={SELECT}
            value={origin}
            onChange={(e) => setOrigin(e.target.value as ContractOrigin | "")}
          >
            <option value="">הכל</option>
            <option value="linked">{ORIGIN_LABEL.linked}</option>
            <option value="standalone">{ORIGIN_LABEL.standalone}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sg-from">נחתם — מתאריך</Label>
          <Input
            id="sg-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sg-to">עד תאריך</Label>
          <Input
            id="sg-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={rangeBad}
            className="min-h-11"
          />
        </div>
      </div>
      {rangeBad ? (
        <p className="text-sm text-destructive" role="alert">
          טווח התאריכים לא תקין — "עד" לפני "מ-".
        </p>
      ) : list.isError && !list.data ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(list.error)}
        </p>
      ) : !list.data ? (
        <p className="text-sm text-muted-foreground">טוען את המסמכים החתומים…</p>
      ) : list.data.rows.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={filtered ? "לא נמצאו מסמכים חתומים" : "עוד אין מסמכים חתומים"}
          text={
            filtered
              ? "נסו חיפוש אחר או נקו את הסינון."
              : "מסמך שהלקוח חתם עליו יופיע כאן, עם ה-PDF החתום — וגם תקבלו התראה."
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {list.data.total} מסמכים חתומים{filtered ? " תואמים" : ""}
          </p>
          {/* מחשב: טבלה */}
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm" data-testid="signed-table">
              <caption className="sr-only">מסמכים חתומים</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    נחתם
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    הלקוח
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    המסמך
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
                  <tr key={c.id} className="border-t align-top" data-signed={c.number}>
                    <td className="px-3 py-3">
                      <p>{c.signed_at ? formatDateTime(c.signed_at) : "—"}</p>
                      {c.unseen && <NewTag />}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{signerText(c)}</p>
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
                        #{c.number} · {docName(c)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {linkText(c)} · {serviceText(c)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusTag status={c.status} />
                      {!c.has_pdf && (
                        <p className="mt-1 text-xs text-muted-foreground">ה-PDF בהכנה</p>
                      )}
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
                          פרטים<span className="sr-only"> — מסמך #{c.number}</span>
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
          <ul className="flex flex-col gap-3 md:hidden" data-testid="signed-cards">
            {list.data.rows.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border bg-card p-4",
                  c.unseen && "border-sky-300",
                )}
                data-signed={c.number}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{signerText(c)}</p>
                    <p className="text-xs text-muted-foreground">
                      #{c.number} · {docName(c)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusTag status={c.status} />
                    {c.unseen && <NewTag />}
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">נחתם</dt>
                  <dd>{c.signed_at ? formatDateTime(c.signed_at) : "—"}</dd>
                  <dt className="text-muted-foreground">אימייל</dt>
                  <dd dir="ltr" className="text-start break-all">
                    {c.signer_email ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">מקור</dt>
                  <dd>
                    {linkText(c)} · {serviceText(c)}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    onClick={() => setOpenId(c.id)}
                  >
                    פרטים<span className="sr-only"> — מסמך #{c.number}</span>
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
              {list.isFetching ? "טוען…" : "עוד מסמכים"}
            </Button>
          )}
        </>
      )}
      <ContractDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
