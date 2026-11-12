// מסמך עצמאי לחתימה — בלי הזמנה ובלי אירוע (לצד החוזים של הזמנות ואירועים, שלא השתנו):
//   סוג המסמך (חוזה אירוח לטווח קצר · חוזה אירוע · מסמך מדיניות ותנאים) → הדרך:
//     א' — העסק ממלא: לקוח קיים או לקוח חדש (נוצר כרטיס), פרטי המסמך, וקישור אישי במייל;
//     ב' — הלקוח ממלא: העסק ממלא רק את הפרטים העסקיים, יוצר קישור ומעביר ללקוח (וואטסאפ / הודעה /
//          מייל); הלקוח כותב את השם, האימייל והטלפון (ובחוזה — ת"ז וכתובת) וחותם באצבע או בעכבר;
//   → תצוגה מקדימה של הנוסח המלא → יצירה ושליחה. המסד בודק הכול שוב (הוא הסמכות), כולל ההרשאות.
// בשתי הדרכים אפשר לבחור לקוח קיים (בדרך ב' — הפרטים שלו ממולאים מראש מהכרטיס, במסד). התצוגה המקדימה —
// גם במסך מלא. בטלפון: שורת פעולה קבועה בתחתית (בדיקת המסמך + שליחה / יצירת קישור), והקישור — גם בשיתוף
// מהמכשיר ובחתימה כאן, במכשיר הזה.
// מסמך עצמאי לא שומר תאריכים ולא יוצר הזמנה / אירוע.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, Info, Link2, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
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
} from "@/platform/ui";
import {
  hospitalityContractStandaloneCreate,
  hospitalityContractStandalonePreview,
} from "../../api/contracts.functions";
import { BLANK } from "../../contracts/blocks";
import { ContractBody } from "../../contracts/ContractBody";
import {
  DEPOSIT_METHOD_LABEL,
  STANDALONE_KIND_LABEL,
  type ContractFillMode,
  type ContractKind,
  type ContractsView,
  type DepositMethod,
  type PolicyDocKind,
  type StandaloneInput,
  type StandaloneResult,
  type StandaloneTarget,
} from "../../types/contracts";
import { EVENT_TYPES, EVENT_TYPE_LABEL } from "../../types/events";
import { errorText } from "../catalog/refresh";
import { formatDateTime, formatMoney } from "../lib/format";
import { SectionCard } from "../ui/kit";
import { Choice, GuestPicker, Step } from "./form-parts";
import { CONTRACTS_KEY, SELECT, useDebounced } from "./model";
import { SignLinkBox } from "./SignLinkBox";

type CustomerMode = "existing" | "new";
type PoolMode = "window" | "custom" | "none";
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** רשימת בחירה — 16px בטלפון (בלי הגדלת מסך ב-iOS) */
const SEL = cn(SELECT, "max-sm:text-base");
const num = (s: string) => (s.trim() === "" ? null : Number(s));
const badMoney = (s: string) => {
  const n = num(s);
  return n !== null && (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100);
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function StandaloneDocument({ view }: { view: ContractsView }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ContractKind>("policy");
  const [fill, setFill] = useState<ContractFillMode>("business");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("new");
  const [guest, setGuest] = useState<{ id: string; name: string } | null>(null);
  // האימייל של הלקוח הקיים — מהתצוגה המקדימה (מהכרטיס, במסד), נשמר גם בזמן שהיא מתרעננת
  const [guestEmail, setGuestEmail] = useState("");
  const pickGuest = (g: { id: string; name: string } | null) => {
    setGuest(g);
    setGuestEmail("");
  };
  const [person, setPerson] = useState({ full_name: "", email: "", phone: "" });
  const [alsoEmail, setAlsoEmail] = useState(false);
  // מסמך מדיניות
  const [docKind, setDocKind] = useState<PolicyDocKind | "">(view.documents[0]?.kind ?? "");
  // חוזה אירוח
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [units, setUnits] = useState<string[]>([]);
  const [whole, setWhole] = useState(false);
  const [price, setPrice] = useState("");
  const [eventFee, setEventFee] = useState("");
  const [deposit, setDeposit] = useState<DepositMethod | "">("");
  // חוזה אירוע
  const [eventDate, setEventDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [eventType, setEventType] = useState<string>("");
  const [eventOther, setEventOther] = useState("");
  const [participants, setParticipants] = useState("");
  const [eventDeposit, setEventDeposit] = useState("");
  const [lateFee, setLateFee] = useState("");
  const [poolMode, setPoolMode] = useState<PoolMode>("window");
  const [poolStart, setPoolStart] = useState("");
  const [poolEnd, setPoolEnd] = useState("");
  const [result, setResult] = useState<StandaloneResult | null>(null);

  const unitNames = view.terms.unit_lines.map((u) => u.name);
  const moneyProblem =
    badMoney(price) ||
    badMoney(eventFee) ||
    badMoney(eventDeposit) ||
    badMoney(lateFee) ||
    (participants.trim() !== "" && !Number.isInteger(Number(participants)));

  // מה שנשלח למסד — רק כשיש מספיק פרטים לתצוגה מקדימה (המסד בודק הכול שוב)
  const input: StandaloneInput | null = useMemo(() => {
    if (kind === "policy") return docKind ? { document_kind: docKind } : null;
    if (kind === "hosting") {
      if (!checkIn || !checkOut || num(price) === null || (!whole && units.length === 0))
        return null;
      return {
        check_in: checkIn,
        check_out: checkOut,
        ...(whole ? { whole: true } : { units }),
        price: Number(price),
        event_fee: num(eventFee),
        deposit_method: deposit || null,
      };
    }
    if (!eventDate || !TIME.test(start) || !TIME.test(end) || !eventType) return null;
    if (num(participants) === null || num(price) === null) return null;
    if (eventType === "other" && !eventOther.trim()) return null;
    if (poolMode === "custom" && (!TIME.test(poolStart) || !TIME.test(poolEnd))) return null;
    return {
      event_date: eventDate,
      start_time: start,
      end_time: end,
      event_type: eventType,
      event_type_other: eventType === "other" ? eventOther.trim() : null,
      participants: Number(participants),
      price: Number(price),
      deposit_amount: num(eventDeposit),
      late_fee: num(lateFee),
      ...(poolMode === "custom"
        ? { pool_start_time: poolStart, pool_end_time: poolEnd }
        : poolMode === "none"
          ? { pool_start_time: null, pool_end_time: null }
          : {}),
    };
  }, [
    kind,
    docKind,
    checkIn,
    checkOut,
    units,
    whole,
    price,
    eventFee,
    deposit,
    eventDate,
    start,
    end,
    eventType,
    eventOther,
    participants,
    eventDeposit,
    lateFee,
    poolMode,
    poolStart,
    poolEnd,
  ]);

  const signer = useMemo(() => {
    if (customerMode === "existing") return null;
    const s = {
      ...(person.full_name.trim() ? { full_name: person.full_name.trim() } : {}),
      ...(person.email.trim() ? { email: person.email.trim() } : {}),
      ...(person.phone.trim() ? { phone: person.phone.trim() } : {}),
    };
    return Object.keys(s).length ? s : null;
  }, [customerMode, person]);
  const guestId = customerMode === "existing" ? (guest?.id ?? null) : null;
  const customerReady =
    customerMode === "existing"
      ? guestId !== null
      : fill === "customer" || Boolean(signer?.full_name && signer.email);

  const target: StandaloneTarget | null = useMemo(
    () =>
      input && customerReady && !moneyProblem
        ? { kind, fillMode: fill, guestId, signer, input }
        : null,
    [input, customerReady, moneyProblem, kind, fill, guestId, signer],
  );
  const debounced = useDebounced(target, 400);
  const preview = useQuery({
    queryKey: [...CONTRACTS_KEY, "standalone-preview", debounced],
    enabled: debounced !== null,
    queryFn: () => hospitalityContractStandalonePreview({ data: { ...debounced! } }),
    retry: false,
  });
  const p = preview.data && debounced === target ? preview.data : null;
  const stale = preview.data !== undefined && debounced !== target;
  const blanks = p ? p.body.split(BLANK).length - 1 : 0;
  // דרך ב' — במייל רק אם יש לאן (אימייל שנכתב, או של הלקוח הקיים)
  const linkEmail = customerMode === "existing" ? guestEmail : person.email.trim();
  const deliver: "email" | "link" =
    fill === "business" || (alsoEmail && linkEmail !== "") ? "email" : "link";
  const [fullView, setFullView] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const create = useMutation({
    mutationFn: () => hospitalityContractStandaloneCreate({ data: { ...target!, deliver } }),
    onSuccess: (r) => {
      setResult(r);
      if (r.delivery === "link")
        toast.success(`נוצר מסמך #${r.contract.number} — העבירו את הקישור ללקוח`);
      else if (r.sent) toast.success(`המסמך נשלח ל-${r.contract.signer_email}`);
      else toast.error("השליחה נכשלה — המסמך נשמר כטיוטה ולא סומן כנשלח");
      void qc.invalidateQueries({ queryKey: CONTRACTS_KEY });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const reset = () => setResult(null);
  // אחרי היצירה — התוצאה (הקישור / "נשלח") מול העיניים והפוקוס עליה, גם כשלחצו מהשורה הקבועה בטלפון
  // (שנעלמת)
  useEffect(() => {
    if (!result) return;
    resultRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    resultRef.current?.focus({ preventScroll: true });
  }, [result]);
  const previewEmail = customerMode === "existing" && guestId ? (p?.signer.email ?? "") : "";
  useEffect(() => {
    if (previewEmail) setGuestEmail(previewEmail);
  }, [previewEmail]);
  const chooseKind = (k: ContractKind) => {
    setKind(k);
    reset();
  };
  const toggleUnit = (name: string) =>
    setUnits((u) => (u.includes(name) ? u.filter((x) => x !== name) : [...u, name]));
  const blocked = !p || !p.can_send || create.isPending || moneyProblem;
  const waitingText = !customerReady
    ? customerMode === "existing"
      ? "בחרו לקוח מהרשימה."
      : "מלאו שם ואימייל של הלקוח."
    : moneyProblem
      ? "יש סכום או מספר לא תקין."
      : kind === "policy"
        ? "בחרו מסמך."
        : "מלאו את פרטי החוזה.";
  const actionIcon =
    deliver === "email" ? (
      <Send className="size-4" aria-hidden="true" />
    ) : (
      <Link2 className="size-4" aria-hidden="true" />
    );
  const actionLabel = create.isPending
    ? "יוצר…"
    : deliver === "email"
      ? `שליחה לחתימה${p?.signer.email ? ` ל-${p.signer.email}` : ""}`
      : "יצירת קישור לחתימה";
  // השורה הקבועה בטלפון: מה המצב, במשפט אחד
  const barStatus =
    target === null
      ? waitingText
      : preview.isError && !stale
        ? "יש בעיה בפרטים — ראו בתצוגה המקדימה."
        : !p
          ? "מכין את התצוגה המקדימה…"
          : !p.can_send
            ? p.legal_pending
              ? "תצוגה מקדימה בלבד — השליחה עוד לא נפתחה."
              : 'צריך לאשר קודם את "תנאים ופרטי החוזה".'
            : deliver === "email"
              ? "מוכן — בדקו את המסמך ושלחו לחתימה."
              : "מוכן — בדקו את המסמך וצרו קישור ללקוח.";

  return (
    <div
      className={cn("flex flex-col gap-4", result === null && "max-md:pb-28")}
      data-testid="standalone-document"
    >
      <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          מסמך עצמאי — בלי הזמנה ובלי אירוע במערכת: חוזה ללקוח שעוד לא הזמין באתר, או מסמך מדיניות
          של העסק לחתימה. הוא <strong>לא שומר תאריכים ולא יוצר הזמנה</strong> — כדי לשמור תאריכים,
          צרו הזמנה ביומן (או אירוע) ושלחו את החוזה מתוכה.
        </span>
      </p>

      <Step n={1} title="סוג המסמך">
        <div role="radiogroup" aria-label="סוג המסמך" className="grid gap-2 sm:grid-cols-3">
          <Choice
            name="sd-kind"
            checked={kind === "hosting"}
            onChange={() => chooseKind("hosting")}
            title={STANDALONE_KIND_LABEL.hosting}
            text="הנוסח של חוזה האירוח, עם התאריכים, היחידות והמחיר שתמלאו."
            testId="sd-kind-hosting"
          />
          <Choice
            name="sd-kind"
            checked={kind === "pool_event"}
            onChange={() => chooseKind("pool_event")}
            title={STANDALONE_KIND_LABEL.pool_event}
            text="הנוסח של חוזה מתחם הבריכה, עם תאריך, שעות, סוג האירוע והמחיר."
            testId="sd-kind-pool-event"
          />
          <Choice
            name="sd-kind"
            checked={kind === "policy"}
            onChange={() => chooseKind("policy")}
            title={STANDALONE_KIND_LABEL.policy}
            text="אחד ממסמכי האתר שפרסמתם (תקנון, ביטולים, כללי המקום…) — כלשונו, לאישור וחתימה."
            testId="sd-kind-policy"
          />
        </div>
      </Step>

      <Step n={2} title="מי ממלא">
        <div role="radiogroup" aria-label="מי ממלא" className="grid gap-2 sm:grid-cols-2">
          <Choice
            name="sd-fill"
            checked={fill === "business"}
            onChange={() => {
              setFill("business");
              reset();
            }}
            title="א' — אני ממלא/ת ושולח/ת במייל"
            text={
              kind === "policy"
                ? "בוחרים לקוח קיים או כותבים לקוח חדש. הלקוח מקבל קישור אישי במייל, קורא וחותם."
                : 'בוחרים לקוח קיים או כותבים לקוח חדש וממלאים את פרטי החוזה. הלקוח מקבל קישור אישי במייל, משלים רק ת"ז וכתובת, וחותם.'
            }
            testId="sd-fill-business"
          />
          <Choice
            name="sd-fill"
            checked={fill === "customer"}
            onChange={() => {
              setFill("customer");
              reset();
            }}
            title="ב' — הלקוח ממלא וחותם בעצמו"
            text={
              kind === "policy"
                ? "יוצרים קישור ושולחים ללקוח (וואטסאפ / הודעה / מייל). הלקוח כותב שם, אימייל וטלפון, וחותם באצבע או בעכבר."
                : 'אתם ממלאים רק את הפרטים העסקיים (תאריכים, מחיר). הלקוח כותב שם, אימייל, טלפון, ת"ז וכתובת, וחותם באצבע או בעכבר.'
            }
            testId="sd-fill-customer"
          />
        </div>
      </Step>

      <Step n={3} title="הלקוח">
        <div role="radiogroup" aria-label="הלקוח" className="grid gap-2 sm:grid-cols-2">
          <Choice
            name="sd-customer"
            checked={customerMode === "new"}
            onChange={() => setCustomerMode("new")}
            title={fill === "business" ? "לקוח חדש" : "לקוח חדש (הוא ימלא את הפרטים)"}
            text={
              fill === "business"
                ? "נוצר כרטיס לקוח (אם אין כבר לקוח עם האימייל הזה)."
                : "אפשר לכתוב מראש שם, אימייל או טלפון — לא חובה."
            }
            testId="sd-customer-new"
          />
          <Choice
            name="sd-customer"
            checked={customerMode === "existing"}
            onChange={() => setCustomerMode("existing")}
            title="לקוח קיים"
            {...(fill === "customer"
              ? { text: "הפרטים שלו ממולאים מראש מהכרטיס — והוא יכול לתקן אותם בחתימה." }
              : {})}
            testId="sd-customer-existing"
          />
        </div>
        {customerMode === "existing" && <GuestPicker guest={guest} onPick={pickGuest} />}
        {fill === "customer" && customerMode === "existing" && guest && (
          <p className="text-xs text-muted-foreground" data-testid="sd-existing-note">
            המסמך החתום יישמר בכרטיס של {guest.name} — ודאו שזה הלקוח הנכון, ושהקישור נשלח אליו.
          </p>
        )}
        {fill === "customer" && customerMode === "new" && (
          <p className="text-sm text-muted-foreground">
            לא חובה — הלקוח כותב את הפרטים שלו בחתימה (ויכול לתקן את מה שמילאתם). כתבתם אימייל? אפשר
            לשלוח אליו את הקישור גם במייל.
          </p>
        )}
        {customerMode === "new" && (
          <div className="grid gap-3 sm:grid-cols-3" data-testid="sd-person">
            <Field id="sd-name" label={fill === "business" ? "שם מלא" : "שם מלא (לא חובה)"}>
              <Input
                id="sd-name"
                value={person.full_name}
                maxLength={120}
                autoComplete="off"
                onChange={(e) => setPerson({ ...person, full_name: e.target.value })}
                className="min-h-11"
              />
            </Field>
            <Field
              id="sd-email"
              label={fill === "business" ? "אימייל (לשם נשלח הקישור)" : "אימייל (לא חובה)"}
            >
              <Input
                id="sd-email"
                type="email"
                dir="ltr"
                value={person.email}
                maxLength={254}
                autoComplete="off"
                onChange={(e) => setPerson({ ...person, email: e.target.value })}
                className="min-h-11"
              />
            </Field>
            <Field id="sd-phone" label="טלפון (לא חובה)">
              <Input
                id="sd-phone"
                type="tel"
                dir="ltr"
                value={person.phone}
                maxLength={30}
                autoComplete="off"
                onChange={(e) => setPerson({ ...person, phone: e.target.value })}
                className="min-h-11"
              />
            </Field>
          </div>
        )}
        {fill === "customer" && linkEmail && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={alsoEmail}
              onChange={(e) => setAlsoEmail(e.target.checked)}
              data-testid="sd-also-email"
            />
            <span>
              לשלוח את הקישור גם במייל ל-<span dir="ltr">{linkEmail}</span>
            </span>
          </label>
        )}
      </Step>

      <Step n={4} title={kind === "policy" ? "המסמך" : "פרטי החוזה"}>
        {kind === "policy" ? (
          view.documents.length === 0 ? (
            <p className="text-sm" data-testid="sd-no-documents">
              עוד לא פרסמתם מסמכי אתר.{" "}
              <Link to="/manage/documents" className="underline">
                למסמכי האתר
              </Link>{" "}
              — אחרי הפרסום אפשר לשלוח אותם לחתימה.
            </p>
          ) : (
            <Field
              id="sd-doc"
              label="המסמך לחתימה"
              hint="הגרסה שמפורסמת עכשיו באתר — כלשונה. פרסמתם גרסה חדשה לפני שהלקוח חתם? הוא לא יוכל לחתום על הישנה."
            >
              <select
                id="sd-doc"
                className={SEL}
                value={docKind}
                onChange={(e) => setDocKind(e.target.value as PolicyDocKind)}
                aria-describedby="sd-doc-hint"
              >
                {view.documents.map((d) => (
                  <option key={d.kind} value={d.kind}>
                    {d.title} (גרסה {d.version}, {formatDateTime(d.published_at)})
                  </option>
                ))}
              </select>
            </Field>
          )
        ) : kind === "hosting" ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sd-in" label="תאריך כניסה">
                <Input
                  id="sd-in"
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="min-h-11"
                />
              </Field>
              <Field id="sd-out" label="תאריך יציאה">
                <Input
                  id="sd-out"
                  type="date"
                  value={checkOut}
                  min={checkIn || undefined}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="min-h-11"
                />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">היחידות (סעיף 1 בחוזה)</legend>
              {unitNames.length === 0 ? (
                <p className="text-sm text-destructive">
                  עוד לא הוגדרו יחידות לחוזה — ב"תנאים ופרטי החוזה".
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unitNames.map((u) => (
                    <label
                      key={u}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                        !whole && units.includes(u)
                          ? "border-primary bg-primary/5"
                          : "bg-background",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        disabled={whole}
                        checked={!whole && units.includes(u)}
                        onChange={() => toggleUnit(u)}
                      />
                      {u}
                    </label>
                  ))}
                  <label
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                      whole ? "border-primary bg-primary/5" : "bg-background",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={whole}
                      onChange={(e) => setWhole(e.target.checked)}
                      data-testid="sd-whole"
                    />
                    כל המתחם
                  </label>
                </div>
              )}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="sd-price" label="המחיר, ₪">
                <Input
                  id="sd-price"
                  inputMode="decimal"
                  dir="ltr"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-invalid={badMoney(price)}
                  className="min-h-11"
                />
              </Field>
              <Field id="sd-fee" label="תשלום לאירוע / מסיבה, ₪ (לא חובה)">
                <Input
                  id="sd-fee"
                  inputMode="decimal"
                  dir="ltr"
                  value={eventFee}
                  onChange={(e) => setEventFee(e.target.value)}
                  aria-invalid={badMoney(eventFee)}
                  className="min-h-11"
                />
              </Field>
              <Field id="sd-deposit" label="אמצעי הפיקדון">
                <select
                  id="sd-deposit"
                  className={SEL}
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value as DepositMethod | "")}
                >
                  <option value="">הלקוח יבחר בחתימה</option>
                  {(Object.keys(DEPOSIT_METHOD_LABEL) as DepositMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {DEPOSIT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              הפיקדון לפי התנאים: {formatMoney(view.terms.deposit_amount)}. שעות הכניסה והיציאה —
              מ"הגדרות העסק".
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="sd-date" label="תאריך האירוע">
                <Input
                  id="sd-date"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="min-h-11"
                />
              </Field>
              <Field id="sd-start" label="שעת התחלה">
                <Input
                  id="sd-start"
                  type="time"
                  dir="ltr"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="min-h-11"
                />
              </Field>
              <Field id="sd-end" label="שעת סיום" hint="לפני שעת ההתחלה — למחרת (אחרי חצות).">
                <Input
                  id="sd-end"
                  type="time"
                  dir="ltr"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-describedby="sd-end-hint"
                  className="min-h-11"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="sd-type" label="סוג האירוע">
                <select
                  id="sd-type"
                  className={SEL}
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                >
                  <option value="">בחרו…</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EVENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              {eventType === "other" && (
                <Field id="sd-other" label="סוג האירוע (אחר)">
                  <Input
                    id="sd-other"
                    value={eventOther}
                    maxLength={80}
                    onChange={(e) => setEventOther(e.target.value)}
                    className="min-h-11"
                  />
                </Field>
              )}
              <Field
                id="sd-guests"
                label="מספר משתתפים"
                hint={`עד ${view.terms.max_event_guests} לפי החוזה.`}
              >
                <Input
                  id="sd-guests"
                  inputMode="numeric"
                  dir="ltr"
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  aria-describedby="sd-guests-hint"
                  className="min-h-11"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="sd-eprice" label="המחיר, ₪">
                <Input
                  id="sd-eprice"
                  inputMode="decimal"
                  dir="ltr"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-invalid={badMoney(price)}
                  className="min-h-11"
                />
              </Field>
              <Field
                id="sd-edeposit"
                label="הפיקדון, ₪"
                hint={`ריק — לפי התנאים (${formatMoney(view.terms.deposit_amount)}).`}
              >
                <Input
                  id="sd-edeposit"
                  inputMode="decimal"
                  dir="ltr"
                  value={eventDeposit}
                  onChange={(e) => setEventDeposit(e.target.value)}
                  aria-invalid={badMoney(eventDeposit)}
                  aria-describedby="sd-edeposit-hint"
                  className="min-h-11"
                />
              </Field>
              <Field
                id="sd-late"
                label="דמי איחור לשעה, ₪"
                hint={`ריק — לפי התנאים (${formatMoney(view.terms.event_late_fee_per_hour)}).`}
              >
                <Input
                  id="sd-late"
                  inputMode="decimal"
                  dir="ltr"
                  value={lateFee}
                  onChange={(e) => setLateFee(e.target.value)}
                  aria-invalid={badMoney(lateFee)}
                  aria-describedby="sd-late-hint"
                  className="min-h-11"
                />
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                השימוש בבריכה (שעות הבריכה: {view.terms.pool_open_time}–{view.terms.pool_close_time}
                )
              </legend>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                <Choice
                  name="sd-pool"
                  checked={poolMode === "window"}
                  onChange={() => setPoolMode("window")}
                  title="כל הזמן המותר"
                  text="בתוך שעות האירוע ושעות הבריכה."
                />
                <Choice
                  name="sd-pool"
                  checked={poolMode === "custom"}
                  onChange={() => setPoolMode("custom")}
                  title="שעות מסוימות"
                />
                <Choice
                  name="sd-pool"
                  checked={poolMode === "none"}
                  onChange={() => setPoolMode("none")}
                  title="בלי שימוש בבריכה"
                />
              </div>
              {poolMode === "custom" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="sd-pool-start" label="תחילת השימוש בבריכה">
                    <Input
                      id="sd-pool-start"
                      type="time"
                      dir="ltr"
                      value={poolStart}
                      onChange={(e) => setPoolStart(e.target.value)}
                      className="min-h-11"
                    />
                  </Field>
                  <Field id="sd-pool-end" label="סוף השימוש בבריכה">
                    <Input
                      id="sd-pool-end"
                      type="time"
                      dir="ltr"
                      value={poolEnd}
                      onChange={(e) => setPoolEnd(e.target.value)}
                      className="min-h-11"
                    />
                  </Field>
                </div>
              )}
            </fieldset>
          </div>
        )}
      </Step>

      <SectionCard
        title="תצוגה מקדימה — כפי שהלקוח יראה"
        description={
          p ? `${p.title} · נוסח גרסה ${p.template_version}` : "הנוסח המלא, עם הפרטים שמילאתם"
        }
      >
        {target === null ? (
          <p className="text-sm text-muted-foreground" data-testid="sd-preview-waiting">
            {waitingText}
          </p>
        ) : preview.isError && !stale ? (
          <p className="text-sm text-destructive" role="alert" data-testid="sd-preview-error">
            {errorText(preview.error)}
          </p>
        ) : !p ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            מכין את התצוגה המקדימה…
          </p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="sd-preview">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2 self-start max-sm:w-full"
              onClick={() => setFullView(true)}
              data-testid="sd-preview-full"
            >
              <Eye className="size-4" aria-hidden="true" />
              קריאת המסמך במסך מלא
            </Button>
            {blanks > 0 && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                השדות המסומנים (<mark className="rounded bg-amber-100 px-1">{BLANK}</mark>) ימולאו
                בחתימה{fill === "customer" ? " — על ידי הלקוח" : ""}.
              </p>
            )}
            <div
              className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:max-h-[70vh] sm:p-6"
              role="region"
              aria-label="נוסח המסמך — תצוגה מקדימה"
              tabIndex={0}
            >
              <ContractBody
                body={p.body}
                highlightBlanks
                signatures={
                  kind === "policy" ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      חתימת הלקוח/ה
                    </p>
                  ) : undefined
                }
              />
            </div>
          </div>
        )}
      </SectionCard>

      <Step n={5} title={deliver === "email" ? "שליחה לחתימה" : "יצירת קישור לחתימה"}>
        {p && !p.can_send && (
          <p className="text-sm text-muted-foreground" data-testid="sd-send-blocked">
            {p.legal_pending
              ? "השליחה ללקוחות תיפתח אחרי הבדיקה והאישור המשפטי של המסמכים. בינתיים — תצוגה מקדימה בלבד."
              : 'בעל העסק צריך לאשר את "תנאים ופרטי החוזה" לפני שליחת החוזה הראשון.'}{" "}
            {!p.legal_pending && (
              <Link
                to="/manage/client-documents"
                search={{ tab: "terms" }}
                target="_blank"
                rel="noopener"
                className="font-medium text-foreground underline"
              >
                לתנאים ופרטי החוזה
                <span className="sr-only"> (נפתח בחלון חדש — מה שמילאתם כאן נשמר)</span>
              </Link>
            )}
          </p>
        )}
        <div
          ref={resultRef}
          tabIndex={-1}
          className="flex scroll-mb-40 flex-col gap-3 outline-none empty:hidden"
        >
          {result && result.delivery === "email" && (
            <div
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3 text-sm",
                result.sent
                  ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                  : "border-red-300 bg-red-50 text-red-950",
              )}
              role="status"
              data-testid="sd-result"
            >
              {result.sent ? (
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  מסמך #{result.contract.number} נשלח ל-
                  <span dir="ltr">{result.contract.signer_email}</span>
                  {result.contract.link_expires_at
                    ? ` · הקישור תקף עד ${formatDateTime(result.contract.link_expires_at)}`
                    : ""}
                </p>
              ) : (
                <p>
                  השליחה נכשלה — מסמך #{result.contract.number} נשמר כטיוטה ולא סומן כנשלח.
                  {result.error ? ` (${result.error})` : ""} אפשר לנסות שוב מהארכיון.
                </p>
              )}
            </div>
          )}
          {result && result.delivery === "link" && result.link && (
            <SignLinkBox
              url={result.link.url}
              expiresAt={result.link.expires_at}
              title={result.contract.title}
              phone={result.contract.signer_phone}
              number={result.contract.number}
              deviceActions
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="min-h-11 gap-2"
            disabled={blocked || result !== null}
            onClick={() => create.mutate()}
            data-testid="sd-create"
          >
            {actionIcon}
            {actionLabel}
          </Button>
          {result && (
            <Button type="button" variant="outline" className="min-h-11" onClick={reset}>
              מסמך נוסף
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {deliver === "email"
            ? "הלקוח מקבל במייל קישור אישי לחתימה, תקף לזמן מוגבל ולחתימה אחת. אם המייל לא יוצא — המסמך לא מסומן כנשלח."
            : "הקישור תקף לזמן מוגבל ולחתימה אחת, ומוצג לכם פעם אחת בלבד."}{" "}
          אחרי החתימה — העותק החתום (PDF) נשלח ללקוח, נשמר ב"מסמכים חתומים", ותקבלו התראה.
        </p>
      </Step>

      {/* בטלפון: הפעולה תמיד בהישג יד, מעל הניווט התחתון */}
      {result === null && (
        <div
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-card/95 px-3 pt-2 pb-2.5 shadow-[0_-8px_24px_-18px_rgb(12_48_47/0.35)] backdrop-blur md:hidden"
          data-testid="sd-mobile-bar"
        >
          <p className="mb-1.5 text-xs text-muted-foreground" aria-live="polite">
            {barStatus}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 gap-1.5 px-2"
              disabled={!p}
              onClick={() => setFullView(true)}
              data-testid="sd-mobile-review"
            >
              <Eye className="size-4" aria-hidden="true" />
              בדיקת המסמך
            </Button>
            <Button
              type="button"
              className="min-h-11 flex-[1.6] gap-1.5 px-2"
              disabled={blocked}
              onClick={() => create.mutate()}
              data-testid="sd-mobile-create"
            >
              {actionIcon}
              {create.isPending ? "יוצר…" : deliver === "email" ? "שליחה לחתימה" : "יצירת קישור"}
            </Button>
          </div>
        </div>
      )}

      {/* המסמך המלא, לקריאה לפני השליחה — נוח במיוחד בטלפון */}
      <Sheet open={fullView && p !== null} onOpenChange={setFullView}>
        <SheetContent
          side="bottom"
          dir="rtl"
          className="flex h-[94dvh] flex-col gap-0 rounded-t-2xl p-0"
          data-testid="sd-full"
        >
          <SheetHeader className="border-b p-4 pe-12 text-start">
            <SheetTitle>{p?.title ?? "המסמך"}</SheetTitle>
            <SheetDescription>
              כפי שהלקוח יראה{p ? ` · נוסח גרסה ${p.template_version}` : ""}
              {blanks > 0 ? " · השדות המסומנים ימולאו בחתימה" : ""}
            </SheetDescription>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto bg-white p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset sm:p-8"
            role="region"
            aria-label="נוסח המסמך — מסך מלא"
            tabIndex={0}
          >
            {p && (
              <ContractBody
                body={p.body}
                highlightBlanks
                signatures={
                  <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {kind === "policy" ? "חתימת הלקוח/ה" : "החתימות — בחתימה של הלקוח"}
                  </p>
                }
              />
            )}
          </div>
          <div className="flex gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1"
              onClick={() => setFullView(false)}
            >
              חזרה לעריכה
            </Button>
            <Button
              type="button"
              className="min-h-11 flex-[1.6] gap-1.5"
              disabled={blocked || result !== null}
              onClick={() => {
                setFullView(false);
                create.mutate();
              }}
              data-testid="sd-full-create"
            >
              {actionIcon}
              {deliver === "email" ? "שליחה לחתימה" : "יצירת קישור"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
