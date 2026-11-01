// הזמנה מהאתר (/stay/book): יחידה, תאריכים (לוח עם לילות תפוסים), אורחים → הצעת מחיר מהשרת
// (לילות, סה"כ, מקדמה, לוח ביטול מדויק) → פרטי האורח + אישור התנאים → בקשת הזמנה.
// המחיר, הזמינות והתנאים נבדקים שוב במסד בזמן השליחה (policy_hash; EXCLUDE נגד הזמנה כפולה).
// מזהה בקשה קבוע לכל ניסיון — לחיצה כפולה / רענון לא יוצרים שתי בקשות.
// אימות נגד בוטים (D1): אתגר שנפתר ברקע (lib/bot-check) + שדה מלכודת מוסתר — בלי שום פעולה
// מהאורח ובלי עוגיות.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Minus, Phone, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/platform/ui";
import {
  hospitalitySiteQuote,
  hospitalitySiteQuoteType,
  hospitalitySiteRequestBooking,
  hospitalitySiteRequestBookingType,
} from "../../api/website.functions";
import { CAPTCHA_RETRY, TRAP_FIELD } from "../../security/messages";
import type { PublicUnit } from "../../types/website";
import { AvailabilityCalendar, type DateRange } from "../components/AvailabilityCalendar";
import { Photo } from "../components/Photo";
import { useCopy } from "../copy";
import { nightsBetween } from "../lib/dates";
import {
  findUnit,
  money,
  rulesLines,
  scheduleLines,
  stayText,
  telHref,
  whatsappHref,
} from "../lib/format";
import type { BookSearch } from "../lib/booking";
import { useBotCheck } from "../lib/bot-check";
import {
  findType,
  listingId,
  siteListing,
  type ListingItem,
  type TypeListing,
} from "../lib/listing";
import { unitCover } from "../lib/media";
import { useSite } from "../lib/site-context";

function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : fallback;

export function BookingPage() {
  const t = useCopy();
  const { site } = useSite();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as BookSearch;
  const listing = useMemo(() => siteListing(site), [site]);
  const units = site.units;
  // הבחירה: יחידה או סוג חדר (קישור לחדר ששייך לסוג → הסוג)
  const [selection, setSelection] = useState<ListingItem | undefined>(() => {
    const byType = findType(site, search.type);
    if (byType) return { kind: "type", type: byType };
    const u = findUnit(units, search.unit);
    if (u) {
      const owner = listing.find(
        (i) => i.kind === "type" && i.type.rooms.some((r) => r.id === u.id),
      );
      return owner ?? { kind: "unit", unit: u };
    }
    return listing.length === 1 ? listing[0] : undefined;
  });
  const roomType = selection?.kind === "type" ? selection.type : undefined;
  // היחידה שמגדירה את המגבלות (בסוג — החדר הראשון; התפוסה — המקסימום של הסוג)
  const unit = selection?.kind === "unit" ? selection.unit : roomType?.lead;
  const capacity = roomType?.capacity ?? unit?.capacity ?? 20;
  const preferredRoom = useRef<string | null>(null);
  const [range, setRange] = useState<DateRange>({
    from: search.from && search.from >= site.today ? search.from : null,
    to: search.from && search.to && search.to > search.from ? search.to : null,
  });
  const [adults, setAdults] = useState(Math.max(1, search.adults ?? Math.min(2, capacity)));
  const [children, setChildren] = useState(search.children ?? 0);
  const [step, setStep] = useState<"choose" | "details">("choose");
  const keyRef = useRef(newKey());

  // הכתובת משקפת את הבחירה (רענון / שיתוף שומרים אותה)
  useEffect(() => {
    void navigate({
      to: "/stay/book",
      search: {
        ...(roomType ? { type: roomType.type.slug } : unit ? { unit: unit.slug } : {}),
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
        adults,
        children,
      },
      replace: true,
      resetScroll: false,
    });
  }, [unit, roomType, range.from, range.to, adults, children, navigate]);

  // שינוי בבחירה = ניסיון חדש (מזהה בקשה חדש)
  useEffect(() => {
    keyRef.current = newKey();
  }, [unit?.id, roomType?.type.id, range.from, range.to, adults, children]);

  const maxAdults = Math.min(unit?.max_adults ?? capacity, capacity);
  const maxChildren = Math.min(
    unit?.max_children ?? Math.max(0, capacity - 1),
    Math.max(0, capacity - adults),
  );
  useEffect(() => {
    if (adults > maxAdults) setAdults(Math.max(1, maxAdults));
    if (children > maxChildren) setChildren(Math.max(0, maxChildren));
  }, [adults, children, maxAdults, maxChildren]);

  const ready = !!unit && !!range.from && !!range.to;
  const quote = useQuery({
    queryKey: [
      "hospitality",
      "site",
      "quote",
      roomType ? `type:${roomType.type.id}` : unit?.id,
      range.from,
      range.to,
      adults,
      children,
    ],
    queryFn: async () => {
      const stay = { checkIn: range.from!, checkOut: range.to!, adults, children };
      // סוג חדר: המסד בוחר חדר פנוי (החדר מההצעה הקודמת קודם, כדי שהתנאים לא יתחלפו)
      const q = roomType
        ? await hospitalitySiteQuoteType({
            data: { categoryId: roomType.type.id, preferredUnit: preferredRoom.current, ...stay },
          })
        : await hospitalitySiteQuote({ data: { unitId: unit!.id, ...stay } });
      if (q.available) preferredRoom.current = q.unit_id;
      return q;
    },
    enabled: ready && site.booking_open,
    retry: false,
    staleTime: 30_000,
  });

  if (!site.booking_open) return <BookingClosed />;
  if (units.length === 0)
    return (
      <PageFrame>
        <p className="text-muted-foreground">{t.book.noUnits}</p>
      </PageFrame>
    );

  const q = quote.data;
  const canContinue = ready && !!q?.available;

  return (
    <PageFrame>
      <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-14">
        <div className="min-w-0">
          {step === "choose" ? (
            <div className="space-y-12">
              <Field title={t.book.unit} index={1}>
                <UnitPicker
                  items={listing}
                  value={selection}
                  onChange={(i) => {
                    preferredRoom.current = null;
                    setSelection(i);
                  }}
                />
              </Field>
              <Field title={t.book.dates} index={2}>
                {unit ? (
                  <>
                    <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
                      {!range.from
                        ? t.book.pickArrival
                        : !range.to
                          ? t.book.pickDeparture
                          : `${stayText(range.from, range.to, t.locale)} · ${t.book.nights(nightsBetween(range.from, range.to))}`}
                      {range.from && (
                        <button
                          type="button"
                          onClick={() => setRange({ from: null, to: null })}
                          className="ms-3 underline underline-offset-4 hover:text-foreground"
                        >
                          {t.book.clearDates}
                        </button>
                      )}
                    </p>
                    <AvailabilityCalendar
                      {...(roomType ? { typeId: roomType.type.id } : { unitId: unit.id })}
                      today={site.today}
                      range={range}
                      onSelect={setRange}
                      minNights={roomType?.minNights ?? unit.min_nights}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.book.chooseUnit}</p>
                )}
              </Field>
              <Field title={t.book.guests} index={3}>
                <div className="grid max-w-md gap-4">
                  <Stepper
                    label={t.book.adults}
                    value={adults}
                    min={1}
                    max={Math.max(1, maxAdults)}
                    onChange={setAdults}
                  />
                  {(unit?.max_children ?? 1) > 0 && (
                    <Stepper
                      label={t.book.children}
                      hint={
                        unit?.child_age_limit != null
                          ? t.book.childrenHint(unit.child_age_limit)
                          : undefined
                      }
                      value={children}
                      min={0}
                      max={Math.max(0, maxChildren)}
                      onChange={setChildren}
                    />
                  )}
                  {unit && (
                    <p className="text-sm text-muted-foreground">{t.book.capacity(capacity)}</p>
                  )}
                </div>
              </Field>
              <div className="lg:hidden">
                <Summary
                  unit={unit}
                  name={roomType?.type.name ?? unit?.name}
                  quote={quote}
                  adults={adults}
                  children={children}
                />
              </div>
              <button
                type="button"
                disabled={!canContinue}
                onClick={() => {
                  setStep("details");
                  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
                }}
                className="inline-flex h-12 w-full items-center justify-center rounded-sm bg-primary px-8 text-base font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {t.book.continue}
              </button>
            </div>
          ) : (
            <GuestForm
              unit={unit!}
              roomType={roomType}
              quote={q!}
              idempotencyKey={keyRef.current}
              onBack={() => setStep("choose")}
              onTermsChanged={() => {
                setStep("choose");
                void quote.refetch();
              }}
            />
          )}
        </div>
        <aside className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
          <Summary
            unit={unit}
            name={roomType?.type.name ?? unit?.name}
            quote={quote}
            adults={adults}
            children={children}
          />
        </aside>
      </div>
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  const t = useCopy();
  return (
    <div className="bg-background pt-24 sm:pt-28">
      <div className="mx-auto max-w-7xl px-4 pb-20 sm:px-8">
        <header className="mb-10 border-b border-border pb-8">
          <h1 className="font-display text-3xl font-medium sm:text-4xl">{t.book.title}</h1>
          <p className="mt-2 text-muted-foreground">{t.book.subtitle}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({ title, index, children }: { title: string; index: number; children: ReactNode }) {
  return (
    <section aria-labelledby={`book-step-${index}`}>
      <h2 id={`book-step-${index}`} className="mb-5 flex items-center gap-3 text-xl font-medium">
        <span
          aria-hidden="true"
          className="inline-flex size-8 items-center justify-center rounded-full border border-[var(--site-gold)] text-sm text-[var(--site-gold-ink)]"
        >
          {index}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function UnitPicker({
  items,
  value,
  onChange,
}: {
  items: ListingItem[];
  value: ListingItem | undefined;
  onChange: (i: ListingItem) => void;
}) {
  const t = useCopy();
  const { site } = useSite();
  return (
    <div role="radiogroup" aria-label={t.book.unit} className="grid gap-3 sm:grid-cols-2">
      {items.map((i) => {
        const id = listingId(i);
        const selected = !!value && listingId(value) === id;
        const lead = i.kind === "unit" ? i.unit : i.type.lead;
        const name = i.kind === "unit" ? i.unit.name : i.type.type.name;
        const capacity = i.kind === "unit" ? i.unit.capacity : i.type.capacity;
        const price = i.kind === "unit" ? i.unit.base_price : i.type.fromPrice;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(i)}
            className={cn(
              "flex items-center gap-4 rounded-[var(--radius)] border bg-card p-3 text-start transition-colors",
              selected
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-foreground/30",
            )}
          >
            <Photo
              media={unitCover(lead, site)}
              alt={name}
              sizes="96px"
              className="size-20 shrink-0 rounded-sm"
            />
            <span className="min-w-0">
              <span className="block font-medium">{name}</span>
              <span className="block text-sm text-muted-foreground">
                {t.units.guests(capacity)}
                {price > 0 && ` · ${t.facts.from}${money(price, site.business.currency)}`}
              </span>
              {i.kind === "type" && (
                <span className="block text-xs text-muted-foreground">
                  {t.units.roomsOfType(i.type.rooms.length)}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const t = useCopy();
  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-border bg-card px-4 py-3">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="inline-flex size-10 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-30"
          aria-label={t.book.less(label)}
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <output className="w-6 text-center text-lg tabular-nums" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="inline-flex size-10 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-30"
          aria-label={t.book.more(label)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

type QuoteState = ReturnType<typeof useQuery<Awaited<ReturnType<typeof hospitalitySiteQuote>>>>;

function Summary({
  unit,
  name,
  quote,
  adults,
  children,
}: {
  unit: PublicUnit | undefined;
  name: string | undefined;
  quote: QuoteState;
  adults: number;
  children: number;
}) {
  const t = useCopy();
  const { site } = useSite();
  const q = quote.data;
  const property = unit ? site.properties.find((p) => p.id === unit.property_id) : undefined;
  const rules = property ? rulesLines(property, t) : [];
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--site-shadow)]">
      <h2 className="font-display text-2xl">{t.book.summary}</h2>
      {unit && (
        <p className="mt-2 text-sm text-muted-foreground">
          {name ?? unit.name} · {t.my.guestsText(adults, children)}
        </p>
      )}
      <div className="mt-5 border-t border-border pt-5" aria-live="polite">
        {!unit || !q ? (
          quote.isFetching ? (
            <p className="text-sm text-muted-foreground">{t.book.calculating}</p>
          ) : quote.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errText(quote.error, t.book.error)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t.book.pickToPrice}</p>
          )
        ) : !q.available ? (
          <p role="alert" className="text-sm text-destructive">
            {t.book.unavailable}
          </p>
        ) : (
          <QuoteDetails quote={q} rules={rules} />
        )}
      </div>
    </div>
  );
}

function QuoteDetails({
  quote: q,
  rules,
}: {
  quote: Awaited<ReturnType<typeof hospitalitySiteQuote>>;
  rules: string[];
}) {
  const t = useCopy();
  const { site } = useSite();
  const nights = useMemo(() => {
    // לילות באותו מחיר — שורה אחת ("2 לילות × ₪750")
    const groups: { price: number; count: number }[] = [];
    for (const n of q.nights) {
      const last = groups[groups.length - 1];
      if (last && last.price === Number(n.price)) last.count += 1;
      else groups.push({ price: Number(n.price), count: 1 });
    }
    return groups;
  }, [q.nights]);
  const lines = scheduleLines(q.policy, t);
  const guestText =
    typeof q.policy.rules["guest_text"] === "string" ? q.policy.rules["guest_text"] : null;
  return (
    <div className="space-y-5 text-sm">
      <p className="font-medium">
        {stayText(q.check_in, q.check_out, t.locale)} · {t.book.nights(q.nights_count)}
      </p>
      <dl className="space-y-2">
        {nights.map((g, i) => (
          <div key={i} className="flex justify-between gap-4 text-muted-foreground">
            <dt>
              {g.count > 1 ? `${t.book.nights(g.count)} × ` : `${t.book.night} · `}
              {money(g.price, q.currency)}
            </dt>
            <dd className="tabular-nums">{money(g.price * g.count, q.currency)}</dd>
          </div>
        ))}
        {Number(q.discount) > 0 && (
          <div className="flex justify-between gap-4 text-[var(--site-gold-ink)]">
            <dt>{t.book.discount}</dt>
            <dd className="tabular-nums">−{money(Number(q.discount), q.currency)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3 text-base">
          <dt className="font-medium">{t.book.total}</dt>
          <dd className="font-display text-2xl tabular-nums">
            {money(Number(q.total), q.currency)}
          </dd>
        </div>
        {Number(q.deposit_amount) > 0 && (
          <p className="text-muted-foreground">
            {t.book.deposit(money(Number(q.deposit_amount), q.currency))}
          </p>
        )}
      </dl>
      <p className="rounded-sm bg-[var(--site-sand)] px-3 py-2 text-xs leading-relaxed">
        {site.business.booking_mode === "instant"
          ? t.book.instantNote
          : t.book.requestNote(site.business.approval_hours)}{" "}
        {t.book.noCharge}
      </p>
      {/* D4: אין סליקה באתר — התשלום בטלפון מול העסק */}
      <p
        className="flex items-start gap-2 rounded-sm border border-[var(--site-gold)] px-3 py-2 text-xs leading-relaxed"
        data-testid="pay-by-phone"
      >
        <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t.book.payByPhone}
      </p>
      <div>
        <h3 className="mb-2 font-medium">{t.book.cancellation}</h3>
        <ul className="space-y-1 text-muted-foreground">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {guestText && <p className="mt-2 text-muted-foreground">{guestText}</p>}
      </div>
      {rules.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium">{t.book.houseRules}</h3>
          <ul className="space-y-1 text-muted-foreground">
            {rules.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GuestForm({
  unit,
  roomType,
  quote,
  idempotencyKey,
  onBack,
  onTermsChanged,
}: {
  unit: PublicUnit;
  roomType: TypeListing | undefined;
  quote: Awaited<ReturnType<typeof hospitalitySiteQuote>>;
  idempotencyKey: string;
  onBack: () => void;
  onTermsChanged: () => void;
}) {
  const t = useCopy();
  const { site } = useSite();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");
  const [accept, setAccept] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [trap, setTrap] = useState("");
  const bot = useBotCheck();
  // נגישות: הכפתור "המשך" נעלם במעבר לשלב הזה — הפוקוס עובר לכותרת השלב (קורא מסך מקריא אותה)
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const send = useMutation({
    mutationFn: async () => {
      const captcha = await bot.solution();
      if (!captcha) throw new Error(CAPTCHA_RETRY);
      const guest = {
        checkIn: quote.check_in,
        checkOut: quote.check_out,
        adults: quote.adults,
        children: quote.children,
        fullName,
        phone,
        email,
        specialRequests: requests,
        idempotencyKey,
        policyHash: quote.policy_hash,
        policyAccepted: accept,
        marketingConsent: marketing,
        language: t.locale,
        captcha,
        [TRAP_FIELD]: trap,
      };
      // סוג חדר: המסד בוחר חדר פנוי מהסוג (החדר מההצעה קודם) באותה טרנזקציה
      return roomType
        ? hospitalitySiteRequestBookingType({
            data: { categoryId: roomType.type.id, preferredUnit: quote.unit_id, ...guest },
          })
        : hospitalitySiteRequestBooking({ data: { unitId: unit.id, ...guest } });
    },
    onSuccess: (r) => {
      void navigate({
        to: "/stay/booking-received",
        hash: r.manage_token ? `t=${r.manage_token}` : `n=${r.number}`,
      });
    },
    onError: (e) => {
      if (e instanceof Error && e.message.includes("התנאים")) onTermsChanged();
      // האתגר פג / כבר נוצל — אתגר חדש מתחיל להיפתר כבר עכשיו, לקראת הלחיצה הבאה
      if (e instanceof Error && e.message === CAPTCHA_RETRY) void bot.renew();
    },
  });
  const missing = (v: string) => touched && v.trim() === "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!fullName.trim() || !phone.trim() || !email.trim() || !accept) return;
    send.mutate();
  };
  const input =
    "mt-1.5 block h-12 w-full rounded-sm border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive";
  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-6">
      <div className="lg:hidden">
        <p className="text-sm text-muted-foreground">
          {roomType?.type.name ?? unit.name} · {stayText(quote.check_in, quote.check_out, t.locale)}{" "}
          · {money(Number(quote.total), quote.currency)}
        </p>
      </div>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-medium outline-none">
        {t.book.details}
      </h2>
      <label className="block">
        <span className="text-sm font-medium">{t.book.fullName}</span>
        <input
          className={input}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          maxLength={120}
          required
          aria-invalid={missing(fullName)}
        />
        {missing(fullName) && <span className="text-xs text-destructive">{t.book.required}</span>}
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t.book.phone}</span>
        <input
          className={input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          maxLength={30}
          required
          aria-invalid={missing(phone)}
        />
        {missing(phone) && <span className="text-xs text-destructive">{t.book.required}</span>}
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t.book.email}</span>
        <input
          className={input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          maxLength={200}
          required
          aria-invalid={missing(email)}
          aria-describedby="email-hint"
        />
        <span id="email-hint" className="text-xs text-muted-foreground">
          {t.book.emailHint}
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium">{t.book.requests}</span>
        <textarea
          className={cn(input, "h-28 py-2")}
          value={requests}
          onChange={(e) => setRequests(e.target.value)}
          maxLength={2000}
          placeholder={t.book.requestsHint}
        />
      </label>
      <div className="space-y-3 rounded-[var(--radius)] border border-border bg-card p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-1 size-5 accent-[var(--primary)]"
            aria-invalid={touched && !accept}
          />
          <span className="text-sm">{t.book.acceptTerms}</span>
        </label>
        {touched && !accept && (
          <p role="alert" className="text-xs text-destructive">
            {t.book.mustAccept}
          </p>
        )}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-1 size-5 accent-[var(--primary)]"
          />
          <span className="text-sm text-muted-foreground">{t.book.marketing}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          {t.book.privacyNote}{" "}
          <Link to="/stay/privacy" className="underline underline-offset-4">
            {t.book.privacy}
          </Link>
          .
        </p>
      </div>
      {/* מלכודת לבוטים: מוסתר מהעין, מקוראי מסך ומהמקלדת; אדם לא ממלא אותו */}
      <div aria-hidden="true" className="sr-only">
        <label>
          {t.book.trapLabel}
          <input
            type="text"
            name={TRAP_FIELD}
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </label>
      </div>
      {/* D4: לפני השליחה — שוב, שהתשלום לא כאן */}
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t.book.payByPhone}
      </p>
      {send.isPending && bot.state === "working" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.book.verifying}
        </p>
      )}
      {send.isError && (
        <p role="alert" className="rounded-sm bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errText(send.error, t.book.error)}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-12 items-center justify-center rounded-sm border border-foreground/25 px-6 hover:bg-foreground/5"
        >
          {t.book.back}
        </button>
        <button
          type="submit"
          disabled={send.isPending}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-sm bg-primary px-8 text-base font-medium text-primary-foreground disabled:opacity-60 sm:flex-none"
        >
          {send.isPending
            ? t.book.sending
            : site.business.booking_mode === "instant"
              ? t.book.submitInstant
              : t.book.submit}
        </button>
      </div>
    </form>
  );
}

function BookingClosed() {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const wa = b.whatsapp || b.phone;
  return (
    <PageFrame>
      <div className="max-w-xl rounded-[var(--radius)] border border-border bg-card p-8">
        <h2 className="font-display text-2xl">{t.book.closedTitle}</h2>
        <p className="mt-3 text-muted-foreground">{t.book.closed}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {b.phone && (
            <a
              href={telHref(b.phone)}
              className="inline-flex h-11 items-center rounded-sm bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              <span dir="ltr">{b.phone}</span>
            </a>
          )}
          {wa && (
            <a
              href={whatsappHref(wa)}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center rounded-sm border border-foreground/25 px-5 text-sm"
            >
              {t.contact.whatsapp}
            </a>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
