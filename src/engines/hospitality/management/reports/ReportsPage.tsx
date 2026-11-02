// מסך "דוחות" (/manage/reports) — שלב F7: הכנסות לפי חודש ולפי התקופה, הזמנות, תפוסה, ביטולים,
// מקורות, ביצועים לכל יחידה, תשלומים שנגבו ויתרות. סינון: תקופה, יחידה, מקור, סטטוס (בכתובת —
// אפשר לשמור / לשתף). ייצוא: CSV לכל טבלה (נפתח ב-Excel), והדפסה / שמירה כ-PDF.
// המספרים — אותו חישוב כמו לוח הבקרה (מיגרציה 34); כספים רק עם הרשאת reports.finance; הכול לפי העסק.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BarChart3, Download, LockKeyhole, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Button, cn } from "@/platform/ui";
import { hospitalityCatalog } from "../../api/catalog.functions";
import { hospitalityReports } from "../../api/dashboard.functions";
import type { ReportsView } from "../../types/reports";
import { REPORT_SOURCES, REPORT_STATUSES } from "../../validation/reports";
import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS } from "../bookings/model";
import { businessToday } from "../catalog/useUnitExtras";
import { errorText } from "../catalog/refresh";
import { formatMoney, formatNumber } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { EmptyState, ErrorState, NoAccess, PageHeader, SkeletonBlock } from "../ui/kit";
import { csvFileName, downloadCsv, toCsv, type CsvColumn } from "./csv";
import {
  PRESETS,
  balanceColumns,
  bookingColumns,
  cancellationColumns,
  dateLabel,
  effectiveRange,
  monthColumns,
  monthLabel,
  parseReportsSearch,
  paymentColumns,
  paymentsByMethod,
  reportsKey,
  sourceColumns,
  sourceLabel,
  statusLabel,
  unitColumns,
  type ReportPreset,
  type ReportsSearch,
} from "./model";

const SELECT =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto print:hidden";

export function ReportsPage() {
  const ctx = useManagement();
  const navigate = useNavigate();
  const search = parseReportsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const allowed = ctx.permissions["reports"] === true;
  const range = effectiveRange(search, businessToday());
  const q = {
    from: range.from,
    to: range.to,
    units: search.unit ? [search.unit] : null,
    sources: search.source ? [search.source] : null,
    statuses: search.status ? [search.status] : null,
  };
  const query = useQuery({
    queryKey: reportsKey(q),
    queryFn: () => hospitalityReports({ data: q }),
    enabled: allowed,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const catalog = useQuery({
    queryKey: manageKeys.catalog,
    queryFn: () => hospitalityCatalog(),
    enabled: allowed && ctx.permissions["catalog"] === true,
    refetchOnWindowFocus: false,
  });
  const set = (patch: Partial<ReportsSearch>) =>
    void navigate({
      to: "/manage/reports",
      search: Object.fromEntries(
        Object.entries({ ...search, ...patch }).filter(([, v]) => v !== undefined && v !== ""),
      ),
      replace: true,
    });

  if (!allowed) return <NoAccess text="הדוחות פתוחים לבעלי העסק ולמנהלים." />;
  const units =
    catalog.data?.properties.flatMap((p) => p.units.map((u) => ({ id: u.id, name: u.name }))) ??
    query.data?.by_unit.map((u) => ({ id: u.unit_id, name: u.name })) ??
    [];
  const data = query.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 print:max-w-none">
      <PageHeader
        title="דוחות"
        description="הכנסות, תפוסה, מקורות וביצועים — אותם חישובים כמו בלוח הבקרה. ייצוא ל-Excel והדפסה."
        actions={
          <Button
            variant="outline"
            className="min-h-11 gap-2 rounded-xl print:hidden"
            onClick={() => window.print()}
            disabled={!data}
          >
            <Printer className="size-4" aria-hidden="true" />
            הדפסה / PDF
          </Button>
        }
      />

      <form
        role="search"
        aria-label="סינון הדוחות"
        className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] print:hidden"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="תקופה" htmlFor="rep-preset">
          <select
            id="rep-preset"
            className={SELECT}
            value={search.preset ?? "this_month"}
            onChange={(e) => {
              const preset = e.target.value as ReportPreset;
              set(
                preset === "custom"
                  ? { preset, from: range.from, to: range.to }
                  : { preset, from: undefined, to: undefined },
              );
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        {search.preset === "custom" && (
          <>
            <Field label="מתאריך" htmlFor="rep-from">
              <input
                id="rep-from"
                type="date"
                className={SELECT}
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && set({ from: e.target.value })}
              />
            </Field>
            <Field label="עד תאריך" htmlFor="rep-to">
              <input
                id="rep-to"
                type="date"
                className={SELECT}
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && set({ to: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="יחידה" htmlFor="rep-unit">
          <select
            id="rep-unit"
            className={SELECT}
            value={search.unit ?? ""}
            onChange={(e) => set({ unit: e.target.value || undefined })}
          >
            <option value="">כל היחידות</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מקור" htmlFor="rep-source">
          <select
            id="rep-source"
            className={SELECT}
            value={search.source ?? ""}
            onChange={(e) => set({ source: e.target.value || undefined })}
          >
            <option value="">כל המקורות</option>
            {REPORT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="סטטוס הזמנה" htmlFor="rep-status">
          <select
            id="rep-status"
            className={SELECT}
            value={search.status ?? ""}
            onChange={(e) => set({ status: e.target.value || undefined })}
          >
            <option value="">כל הסטטוסים</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </Field>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {dateLabel(range.from)} – {dateLabel(range.to)}
        {search.unit ? ` · ${units.find((u) => u.id === search.unit)?.name ?? "יחידה אחת"}` : ""}
        {search.source ? ` · ${sourceLabel(search.source)}` : ""}
        {search.status ? ` · ${statusLabel(search.status)}` : ""}
        {query.isFetching && data ? " · מתעדכן…" : ""}
      </p>

      {query.isError && !data ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-64" />
          <span className="sr-only">טוען דוחות…</span>
        </div>
      ) : (
        <Report data={data} />
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1 sm:flex-none">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Report({ data }: { data: ReportsView }) {
  const s = data.summary;
  const money = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : formatMoney(n, data.currency);
  const balance = data.balances ? data.balances.reduce((sum, b) => sum + b.balance, 0) : null;
  const tiles: { label: string; value: string; hint?: string; money?: boolean }[] = [
    ...(data.finance
      ? [
          {
            label: "הכנסות",
            value: money(s.revenue),
            hint: "לילות השהייה בתקופה, אחרי הנחות",
            money: true,
          },
          { label: "נגבה", value: money(s.collected), hint: "תשלומים שנרשמו בתקופה", money: true },
          {
            label: "יתרות לתשלום",
            value: money(balance),
            hint: "שהיות בתקופה שלא שולמו במלואן",
            money: true,
          },
          { label: "ממוצע ללילה", value: money(s.adr), money: true },
        ]
      : []),
    { label: "הזמנות חדשות", value: formatNumber(s.bookings) },
    { label: "ביטולים", value: formatNumber(s.cancellations) },
    { label: "לילות שנמכרו", value: formatNumber(s.nights_sold) },
    {
      label: "תפוסה",
      value: s.occupancy === null ? "—" : `${s.occupancy}%`,
      hint: `${formatNumber(s.occupied_nights)} מתוך ${formatNumber(s.available_nights)} לילות`,
    },
  ];
  const fin = data.finance;
  const period = { from: data.period.from, to: data.period.to };
  return (
    <div className="flex flex-col gap-5">
      {!fin && (
        <p className="flex items-center gap-2 rounded-xl border bg-[var(--hm-surface-2)] px-4 py-3 text-sm text-muted-foreground">
          <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
          הנתונים הכספיים (הכנסות, גבייה, יתרות) זמינים לבעלי העסק ולמי שקיבל מהם הרשאה.
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="סיכום התקופה">
        {tiles.map((t) => (
          <li
            key={t.label}
            className="flex flex-col gap-1 rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] print:shadow-none"
          >
            <span className="text-xs text-muted-foreground">{t.label}</span>
            <span className="text-xl font-bold text-[var(--hm-lagoon-900)]" data-num="">
              {t.value}
            </span>
            {t.hint && <span className="text-[11px] text-muted-foreground">{t.hint}</span>}
          </li>
        ))}
      </ul>

      <Section
        title="לפי חודש"
        description="הזמנות חדשות, הכנסות ותפוסה בכל חודש בתקופה."
        csv={{ name: "months", period, columns: monthColumns(fin), rows: data.months }}
      >
        <Table
          label="טבלה: לפי חודש"
          head={["חודש", "הזמנות חדשות", ...(fin ? ["הכנסות"] : []), "תפוסה"]}
          rows={data.months.map((m) => [
            monthLabel(m.start),
            formatNumber(m.bookings),
            ...(fin ? [money(m.revenue)] : []),
            m.occupancy === null ? "—" : `${m.occupancy}%`,
          ])}
          numeric={[1, 2, 3]}
        />
      </Section>

      <Section
        title="מקורות"
        description="מאיפה הגיעו ההזמנות: האתר, טלפון, ערוצים (Airbnb / Booking.com)…"
        csv={{ name: "sources", period, columns: sourceColumns(fin), rows: data.sources }}
      >
        {data.sources.length === 0 ? (
          <Empty />
        ) : (
          <Table
            label="טבלה: מקורות"
            head={["מקור", "הזמנות חדשות", "לילות בתקופה", ...(fin ? ["הכנסות"] : [])]}
            rows={data.sources.map((x) => [
              sourceLabel(x.source, x.channel),
              formatNumber(x.bookings),
              formatNumber(x.nights),
              ...(fin ? [money(x.revenue)] : []),
            ])}
            numeric={[1, 2, 3]}
          />
        )}
      </Section>

      <Section
        title="ביצועים לפי יחידה"
        description={
          'לילות, תפוסה והכנסה של כל יחידה ("כל המתחם" — בלי תפוסה משלו; היא נמדדת ביחידות שבו).'
        }
        csv={{ name: "units", period, columns: unitColumns(fin), rows: data.by_unit }}
      >
        {data.by_unit.length === 0 ? (
          <Empty />
        ) : (
          <Table
            label="טבלה: ביצועים לפי יחידה"
            head={[
              "יחידה",
              "הזמנות",
              "לילות שנמכרו",
              "תפוסה",
              ...(fin ? ["הכנסות", "ממוצע ללילה"] : []),
            ]}
            rows={data.by_unit.map((u) => [
              u.name,
              formatNumber(u.bookings),
              formatNumber(u.nights_sold),
              u.occupancy === null ? "—" : `${u.occupancy}%`,
              ...(fin ? [money(u.revenue), money(u.adr)] : []),
            ])}
            numeric={[1, 2, 3, 4, 5]}
          />
        )}
      </Section>

      <Section
        title="ביטולים"
        description='הזמנות שבוטלו או סומנו "לא הגיעו" בתקופה.'
        csv={{
          name: "cancellations",
          period,
          columns: cancellationColumns(fin),
          rows: data.cancellations,
        }}
      >
        {data.cancellations.length === 0 ? (
          <Empty text="אין ביטולים בתקופה." />
        ) : (
          <Table
            label="טבלה: ביטולים"
            head={["הזמנה", "יחידה", "תאריכים", "סטטוס", "בוטלה ב", ...(fin ? ["סכום"] : [])]}
            rows={data.cancellations.map((c) => [
              `#${c.number}`,
              c.unit,
              `${dateLabel(c.check_in)} – ${dateLabel(c.check_out)}`,
              statusLabel(c.status),
              dateLabel(c.cancelled_at),
              ...(fin ? [money(c.total)] : []),
            ])}
            numeric={[5]}
          />
        )}
      </Section>

      {fin && data.payments && (
        <Section
          title="תשלומים שנגבו"
          description="כל התשלומים שנרשמו בתקופה (החזר — במינוס)."
          csv={{ name: "payments", period, columns: paymentColumns, rows: data.payments }}
        >
          {data.payments.length === 0 ? (
            <Empty text="לא נרשמו תשלומים בתקופה." />
          ) : (
            <>
              <ul className="mb-3 flex flex-wrap gap-2" aria-label="לפי אמצעי תשלום">
                {paymentsByMethod(data.payments).map((m) => (
                  <li
                    key={m.method}
                    className="rounded-full bg-[var(--hm-lagoon-50)] px-3 py-1 text-sm"
                  >
                    {PAYMENT_METHOD_LABELS[m.method] ?? m.method}: <strong>{money(m.total)}</strong>
                  </li>
                ))}
              </ul>
              <Table
                label="טבלה: תשלומים שנגבו"
                head={["תאריך", "הזמנה", "יחידה", "סוג", "אמצעי", "סכום"]}
                rows={data.payments.map((p) => [
                  dateLabel(p.paid_at),
                  `#${p.number}`,
                  p.unit,
                  PAYMENT_KIND_LABELS[p.kind] ?? p.kind,
                  PAYMENT_METHOD_LABELS[p.method] ?? p.method,
                  money(p.amount),
                ])}
                numeric={[5]}
              />
            </>
          )}
        </Section>
      )}

      {fin && data.balances && (
        <Section
          title="יתרות לתשלום"
          description="הזמנות פעילות עם שהות בתקופה שעוד לא שולמו במלואן."
          csv={{ name: "balances", period, columns: balanceColumns, rows: data.balances }}
        >
          {data.balances.length === 0 ? (
            <Empty text="הכול שולם — אין יתרות פתוחות בתקופה." />
          ) : (
            <Table
              label="טבלה: יתרות לתשלום"
              head={["הזמנה", "אורח", "יחידה", "הגעה", "סכום", "שולם", "יתרה"]}
              rows={data.balances.map((b) => [
                `#${b.number}`,
                b.guest ?? "—",
                b.unit,
                dateLabel(b.check_in),
                money(b.total),
                money(b.paid),
                money(b.balance),
              ])}
              numeric={[4, 5, 6]}
            />
          )}
        </Section>
      )}

      <Section
        title="ההזמנות בתקופה"
        description={`כל ההזמנות עם שהות בתקופה (עד ${formatNumber(data.limit)} שורות).`}
        csv={{ name: "bookings", period, columns: bookingColumns(fin), rows: data.bookings }}
      >
        {data.bookings.length === 0 ? (
          <Empty text="אין הזמנות בתקופה לפי הסינון." />
        ) : (
          <Table
            label="טבלה: ההזמנות בתקופה"
            head={["הזמנה", "אורח", "יחידה", "תאריכים", "סטטוס", "מקור", ...(fin ? ["סכום"] : [])]}
            rows={data.bookings.map((b) => [
              `#${b.number}`,
              b.guest ?? "—",
              b.unit,
              `${dateLabel(b.check_in)} – ${dateLabel(b.check_out)}`,
              statusLabel(b.status),
              sourceLabel(b.source, b.channel),
              ...(fin ? [money(b.total)] : []),
            ])}
            numeric={[6]}
          />
        )}
      </Section>
    </div>
  );
}

function Section<T>({
  title,
  description,
  csv,
  children,
}: {
  title: string;
  description: string;
  csv: {
    name: string;
    period: { from: string; to: string };
    columns: CsvColumn<T>[];
    rows: readonly T[];
  };
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] sm:p-5 print:break-inside-avoid print:shadow-none"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1.5 print:hidden"
          disabled={csv.rows.length === 0}
          onClick={() =>
            downloadCsv(
              csvFileName(csv.name, csv.period.from, csv.period.to),
              toCsv(csv.columns, csv.rows),
            )
          }
        >
          <Download className="size-4" aria-hidden="true" />
          ייצוא ל-Excel (CSV)<span className="sr-only"> — {title}</span>
        </Button>
      </div>
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
  numeric = [],
  label,
}: {
  head: string[];
  rows: string[][];
  numeric?: number[];
  label: string;
}) {
  return (
    // בטלפון הטבלה נגללת לרוחב — אזור עם שם, שאפשר להגיע אליו במקלדת
    <div
      className="overflow-x-auto rounded-xl border"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead className="bg-[var(--hm-surface-2)]">
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "px-3 py-2 text-start text-xs font-semibold text-muted-foreground",
                  numeric.includes(i) && "text-end",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t">
              {r.map((c, i) => (
                <td
                  key={i}
                  className={cn("px-3 py-2", numeric.includes(i) && "text-end whitespace-nowrap")}
                  data-num={numeric.includes(i) ? "" : undefined}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text = "אין נתונים בתקופה לפי הסינון." }: { text?: string }) {
  return <EmptyState icon={BarChart3} title={text} className="py-6" />;
}
