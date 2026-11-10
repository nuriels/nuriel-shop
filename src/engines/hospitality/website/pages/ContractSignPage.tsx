// עמוד החתימה של הלקוח (/stay/contract#t=…) — לפי הקישור האישי, בלי חשבון: הנוסח המלא, השדות שחסרים
// (בחוזה: ת"ז / ח.פ וכתובת, ובחוזה אירוח — אמצעי הפיקדון אם העסק לא קבע; במסמך מדיניות — רק אישור;
// ובמסמך שהלקוח ממלא בעצמו — גם השם, האימייל והטלפון), חתימה באצבע / בעכבר
// (או בהקלדת השם — חלופה נגישה), ואישור "קראתי ואני מסכים/ה" — ורק אז חתימה. פעם אחת: אחרי החתימה
// הקישור מת, העותק החתום (PDF) נשלח במייל ואפשר להוריד אותו כאן מיד. הטוקן אחרי ה-# — לא נשלח לשרת
// בבקשת העמוד ולא מופיע ביומני הגישה; הוא עובר רק בבקשה לפונקציה (POST).
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Download, FileSignature, Phone, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@/platform/ui";
import { hospitalityContractOpen, hospitalityContractSign } from "../../api/contracts.functions";
import { ContractBody } from "../../contracts/ContractBody";
import { poolNotice } from "../../contracts/pool-notice";
import { SignaturePad } from "../../contracts/SignaturePad";
import type { ContractSignature } from "../../contracts/signature";
import {
  DEPOSIT_METHOD_LABEL,
  type ContractForSigning,
  type ContractSigned,
  type DepositMethod,
} from "../../types/contracts";
import { israeliIdOk } from "../../validation/contracts";
import { Frame, Notice } from "./GuestBookingPages";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const METHODS: DepositMethod[] = ["cash", "check", "card"];
const FIELD =
  "min-h-12 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function useContractToken(): { token: string | null; ready: boolean } {
  const [state, setState] = useState<{ token: string | null; ready: boolean }>({
    token: null,
    ready: false,
  });
  useEffect(() => {
    const read = () => {
      const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");
      setState({ token: t && TOKEN.test(t) ? t : null, ready: true });
    };
    read();
    window.scrollTo(0, 0);
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return state;
}

const message = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "משהו השתבש — נסו שוב בעוד רגע";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));

export function ContractSignPage() {
  const { token, ready } = useContractToken();
  const open = useQuery({
    queryKey: ["hospitality", "site", "contract", token],
    enabled: token !== null,
    queryFn: () => hospitalityContractOpen({ data: { token: token! } }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [signed, setSigned] = useState<ContractSigned | null>(null);

  if (!ready || (token && open.isPending))
    return (
      <Frame narrow>
        <Notice>טוען את ההסכם…</Notice>
      </Frame>
    );
  if (signed) return <Signed result={signed} />;
  if (!token || open.isError || !open.data)
    return (
      <Frame narrow>
        <h1 className="font-display mb-6 text-3xl font-medium">חתימה על הסכם</h1>
        <div role="alert">
          <Notice>
            {token && open.isError
              ? message(open.error)
              : "הקישור לחתימה לא תקין. פתחו אותו שוב מהמייל שקיבלתם, או פנו לעסק לקבלת קישור חדש."}
          </Notice>
        </div>
      </Frame>
    );
  return <SignForm token={token} c={open.data} onSigned={setSigned} />;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignForm({
  token,
  c,
  onSigned,
}: {
  token: string;
  c: ContractForSigning;
  onSigned: (r: ContractSigned) => void;
}) {
  const pool = poolNotice(c.kind, c.pool);
  const policy = c.kind === "policy";
  const doc = policy ? "המסמך" : "ההסכם";
  // דרך ב': הלקוח כותב את הפרטים שלו (העסק אולי מילא מראש — אפשר לתקן)
  const [fullName, setFullName] = useState(c.signer_name ?? "");
  const [email, setEmail] = useState(c.signer_email ?? "");
  const [phone, setPhone] = useState(c.signer_phone ?? "");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<DepositMethod | "">("");
  const [signature, setSignature] = useState<ContractSignature | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  const digits = idNumber.replace(/\D/g, "");
  const problems = useMemo(() => {
    const p: { field: string; text: string }[] = [];
    if (c.needs_identity) {
      if (fullName.trim().length < 2) p.push({ field: "cs-name", text: "שם מלא" });
      if (!EMAIL.test(email.trim()))
        p.push({ field: "cs-email", text: "אימייל תקין (לשם יישלח העותק החתום)" });
      if (phone.trim() && phone.replace(/\D/g, "").length < 9)
        p.push({ field: "cs-phone", text: "מספר טלפון תקין (או להשאיר ריק)" });
    }
    if (c.needs_id_address) {
      if (!israeliIdOk(digits))
        p.push({
          field: "cs-id",
          text: `${c.id_label} — מספר לא תקין (עד 9 ספרות, כולל ספרת ביקורת)`,
        });
      if (address.trim().length < 4) p.push({ field: "cs-address", text: "כתובת מגורים מלאה" });
    }
    if (c.needs_deposit_method && !method)
      p.push({ field: "cs-method-cash", text: "אמצעי הפיקדון" });
    if (!signature) p.push({ field: "cs-signature", text: "חתימה" });
    if (!agreed) p.push({ field: "cs-agree", text: `אישור שקראתם את ${doc} ושאתם מסכימים לו` });
    return p;
  }, [
    digits,
    address,
    method,
    signature,
    agreed,
    fullName,
    email,
    phone,
    doc,
    c.needs_identity,
    c.needs_id_address,
    c.needs_deposit_method,
    c.id_label,
  ]);
  const bad = (field: string) => tried && problems.some((p) => p.field === field);

  const sign = useMutation({
    mutationFn: () =>
      hospitalityContractSign({
        data: {
          token,
          fields: {
            ...(c.needs_id_address ? { id_number: digits, address: address.trim() } : {}),
            ...(method ? { deposit_method: method } : {}),
            ...(c.needs_identity
              ? {
                  full_name: fullName.trim(),
                  email: email.trim(),
                  ...(phone.trim() ? { phone: phone.trim() } : {}),
                }
              : {}),
          },
          signature: signature!,
          agreed: true,
        },
      }),
    onSuccess: onSigned,
  });
  useEffect(() => {
    if (sign.isError) summary.current?.focus();
  }, [sign.isError]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.length > 0) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    if (!sign.isPending) sign.mutate();
  };

  return (
    <Frame>
      <header className="mb-6 flex flex-col gap-2 border-b border-border pb-6">
        <p className="text-sm text-muted-foreground">
          {c.business_name} · {policy ? c.title : "הסכם"} · מסמך מספר {c.number}
        </p>
        <h1 className="font-display text-3xl font-medium sm:text-4xl">חתימה על {doc}</h1>
        <p className="text-sm text-muted-foreground">
          {policy ? "קראו את המסמך במלואו" : "קראו את כל סעיפי ההסכם"}
          {c.needs_identity || c.needs_id_address ? ", מלאו את הפרטים שלכם" : ""} וחתמו בסוף העמוד.
          הקישור אישי — תקף עד {dateTime(c.expires_at)} ולחתימה אחת בלבד.
        </p>
      </header>

      {/* שעות הבריכה (ובאירוע — השימוש בבריכה בו): לפני הנוסח, מחוץ לו — הנוסח עצמו לא משתנה */}
      {pool && (
        <div
          role="note"
          aria-labelledby="cs-pool-title"
          data-testid="contract-pool-notice"
          className="mb-6 flex gap-3 rounded-[var(--radius)] border border-amber-400 bg-amber-50 p-4 text-amber-950"
        >
          <Waves className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p id="cs-pool-title" className="font-semibold">
              שימו לב — שעות הבריכה
            </p>
            <p>{pool}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="cs-body-title" className="mb-8">
        <h2 id="cs-body-title" className="sr-only">
          {policy ? "נוסח המסמך" : "נוסח ההסכם"}
        </h2>
        <div className="rounded-[var(--radius)] border border-border bg-white p-4 text-[#1f2421] sm:p-8">
          <ContractBody
            body={c.body}
            highlightBlanks
            signatures={
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {policy
                  ? "החתימה — בטופס שבהמשך. אחרי החתימה תקבלו עותק חתום (PDF)."
                  : "החתימות — בטופס שבהמשך. אחרי החתימה תקבלו עותק חתום (PDF) הכולל את חתימת שני הצדדים."}
              </p>
            }
          />
        </div>
      </section>

      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
        data-testid="contract-sign-form"
      >
        <div
          ref={summary}
          tabIndex={-1}
          className={cn(
            "rounded-[var(--radius)] p-4 text-sm",
            (tried && problems.length > 0) || sign.isError
              ? "border border-red-300 bg-red-50 text-red-950"
              : "sr-only",
          )}
          role="alert"
          data-testid="contract-sign-errors"
        >
          {sign.isError ? (
            <p>{message(sign.error)}</p>
          ) : tried && problems.length > 0 ? (
            <>
              <p className="font-medium">כדי לחתום חסר:</p>
              <ul className="mt-1 list-disc ps-5">
                {problems.map((p) => (
                  <li key={p.field}>
                    <a href={`#${p.field}`} className="underline">
                      {p.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        {(c.needs_identity || c.needs_id_address || c.needs_deposit_method || c.signer_name) && (
          <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-medium">
              {policy ? "הפרטים שלכם" : "הפרטים שלכם (צד ב')"}
            </h2>
            {c.needs_identity ? (
              <div className="grid gap-4 sm:grid-cols-3" data-testid="contract-identity">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cs-name" className="text-sm font-medium">
                    שם מלא
                  </label>
                  <input
                    id="cs-name"
                    className={FIELD}
                    autoComplete="name"
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    aria-invalid={bad("cs-name")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cs-email" className="text-sm font-medium">
                    אימייל
                  </label>
                  <input
                    id="cs-email"
                    type="email"
                    className={FIELD}
                    autoComplete="email"
                    dir="ltr"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={bad("cs-email")}
                    aria-describedby="cs-email-hint"
                  />
                  <p id="cs-email-hint" className="text-xs text-muted-foreground">
                    לשם יישלח העותק החתום, ואיתו תוכלו להיכנס לאזור האישי.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cs-phone" className="text-sm font-medium">
                    טלפון (לא חובה)
                  </label>
                  <input
                    id="cs-phone"
                    type="tel"
                    className={FIELD}
                    autoComplete="tel"
                    dir="ltr"
                    maxLength={30}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    aria-invalid={bad("cs-phone")}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm">
                שם מלא: <strong>{c.signer_name}</strong>
                {c.signer_phone && (
                  <>
                    {" "}
                    · טלפון: <span dir="ltr">{c.signer_phone}</span>
                  </>
                )}
                <br />
                <span className="text-muted-foreground">
                  השם או הטלפון לא נכונים? אל תחתמו — פנו לעסק
                  {c.business_phone ? ` (${c.business_phone})` : ""} ונשלח לכם{" "}
                  {policy ? "מסמך מתוקן" : "הסכם מתוקן"}.
                </span>
              </p>
            )}
            {c.needs_id_address && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cs-id" className="text-sm font-medium">
                    {c.id_label}
                  </label>
                  <input
                    id="cs-id"
                    className={FIELD}
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    maxLength={12}
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    aria-invalid={bad("cs-id")}
                    aria-describedby="cs-id-hint"
                  />
                  <p id="cs-id-hint" className="text-xs text-muted-foreground">
                    עד 9 ספרות. נשמר רק בהסכם החתום, ומוצג לעסק חלקית.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cs-address" className="text-sm font-medium">
                    כתובת מגורים
                  </label>
                  <input
                    id="cs-address"
                    className={FIELD}
                    autoComplete="street-address"
                    maxLength={200}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    aria-invalid={bad("cs-address")}
                  />
                </div>
              </div>
            )}
            {c.needs_deposit_method && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">הפיקדון יימסר באמצעות</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {METHODS.map((m) => (
                    <label
                      key={m}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-2 rounded-[var(--radius)] border p-3 text-sm",
                        method === m ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <input
                        id={`cs-method-${m}`}
                        type="radio"
                        name="deposit-method"
                        className="size-4"
                        checked={method === m}
                        onChange={() => setMethod(m)}
                        aria-invalid={bad("cs-method-cash")}
                      />
                      {DEPOSIT_METHOD_LABEL[m]}
                    </label>
                  ))}
                </div>
                {method === "card" && (
                  <p className="text-xs text-muted-foreground">
                    פרטי הכרטיס לא נמסרים כאן — רק לעסק ישירות (בטלפון או במסוף התשלום).
                  </p>
                )}
              </fieldset>
            )}
          </section>
        )}

        <section
          id="cs-signature"
          tabIndex={-1}
          className={cn(
            "flex flex-col gap-3 rounded-[var(--radius)] border bg-card p-5 sm:p-6",
            bad("cs-signature") ? "border-red-400" : "border-border",
          )}
        >
          <h2 className="text-lg font-medium">החתימה</h2>
          <SignaturePad onChange={setSignature} label="החתימה שלכם" testId="customer-signature" />
          <p className="text-xs text-muted-foreground" data-testid="contract-sign-record">
            לתיעוד החתימה נשמרים עם ההסכם: מועד החתימה, כתובת ה-IP והדפדפן שממנו חתמתם. הם מופיעים
            בעותק החתום (PDF), ומשמשים רק להוכחת החתימה.
          </p>
        </section>

        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border bg-card p-4 text-sm",
            bad("cs-agree") ? "border-red-400" : "border-border",
          )}
        >
          <input
            id="cs-agree"
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            aria-invalid={bad("cs-agree")}
          />
          <span>
            {policy
              ? "קראתי את המסמך במלואו, הבנתי אותו ואני מסכים/ה לתנאיו. ידוע לי שהחתימה כאן היא חתימה אלקטרונית על המסמך, ושאחרי החתימה הנוסח לא ישתנה."
              : "קראתי את כל סעיפי ההסכם, הבנתי אותם ואני מסכים/ה להם. ידוע לי שהחתימה כאן היא חתימה אלקטרונית על ההסכם, ושאחרי החתימה הנוסח לא ישתנה."}
          </span>
        </label>

        <button
          type="submit"
          disabled={sign.isPending}
          className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-[var(--radius)] bg-primary px-6 text-base font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          data-testid="contract-sign-submit"
        >
          <FileSignature className="size-5" aria-hidden="true" />
          {sign.isPending ? "חותם…" : `חתימה על ${doc}`}
        </button>
        {(c.business_phone || c.business_email) && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Phone className="size-4" aria-hidden="true" />
            שאלות על {doc}? {c.business_name}
            {c.business_phone ? ` · ${c.business_phone}` : ""}
            {c.business_email ? (
              <>
                {" "}
                · <span dir="ltr">{c.business_email}</span>
              </>
            ) : null}
          </p>
        )}
      </form>
    </Frame>
  );
}

function Signed({ result }: { result: ContractSigned }) {
  const url = useMemo(() => {
    if (!result.pdf) return null;
    try {
      const bin = atob(result.pdf);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    } catch {
      return null;
    }
  }, [result.pdf]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Frame narrow>
      <div className="flex flex-col gap-5" data-testid="contract-signed" role="status">
        <CheckCircle2 className="size-12 text-emerald-600" aria-hidden="true" />
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-display text-3xl font-medium focus:outline-none"
        >
          {result.kind === "policy" ? "המסמך נחתם — תודה!" : "ההסכם נחתם — תודה!"}
        </h1>
        <p>
          {result.kind === "policy" ? "מסמך" : "הסכם"} מספר {result.number} נחתם ונשמר.{" "}
          {result.copy_sent
            ? "עותק חתום (PDF) נשלח אליכם עכשיו במייל."
            : "עותק חתום (PDF) יישלח אליכם במייל בדקות הקרובות."}
        </p>
        {url && (
          <a
            href={url}
            download={`${result.kind === "policy" ? "מסמך" : "הסכם"}-${result.number}.pdf`}
            className="inline-flex min-h-12 items-center gap-2 self-start rounded-[var(--radius)] border border-border px-5 font-medium hover:bg-muted"
            data-testid="contract-signed-download"
          >
            <Download className="size-5" aria-hidden="true" />
            הורדת העותק החתום
          </a>
        )}
        <p className="text-sm text-muted-foreground">
          {result.kind === "policy" ? "המסמך החתום" : "ההסכם החתום"} שמור גם ב
          <Link to="/stay/account" className="underline">
            אזור האישי
          </Link>{" "}
          (כניסה עם קוד למייל). הקישור שבמייל כבר לא פעיל.
        </p>
      </div>
    </Frame>
  );
}
