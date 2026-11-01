// תנאי השהייה: שעות כניסה / יציאה, כללי המקום (ברמת המתחם), ביטולים (מדיניות ברירת המחדל),
// חניה ומידע שימושי לאורחים. מידע רגיש להגעה (קודים) — לעולם לא כאן (D21).
import { CalendarX2, Car, Clock, Info, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import type { PublicPolicy, PublicProperty } from "../../types/website";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy, type SiteCopy } from "../copy";
import { policyLines, rulesLines } from "../lib/format";
import { useSite } from "../lib/site-context";
import type { Section } from "../design/schema";

function parkingLines(p: PublicProperty, t: SiteCopy): string[] {
  if (!p.parking) return [];
  const out = [
    [
      t.terms.parkingKinds[p.parking] ?? p.parking,
      p.parking_type ? t.terms.parkingTypes[p.parking_type] : null,
      p.parking_spaces ? t.terms.parkingSpaces(p.parking_spaces) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  ];
  if (p.parking_fee_note) out.push(p.parking_fee_note);
  return out;
}

export function Terms({
  property,
  policy,
  compact = false,
  section,
}: {
  section?: Section | undefined;
  property?: PublicProperty | undefined;
  policy?: PublicPolicy | null | undefined;
  compact?: boolean;
}) {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const props = property ? [property] : site.properties;
  const cancel = policyLines(policy === undefined ? site.policy : policy, t, b.currency);
  const guestText = (policy === undefined ? site.policy : policy)?.guest_text?.trim();
  const blocks: {
    key: string;
    icon: ReactNode;
    title: string;
    lines: string[];
    text?: string | null | undefined;
  }[] = [];
  const times = [
    b.check_in_time ? t.terms.checkInFrom(b.check_in_time) : null,
    b.check_out_time ? t.terms.checkOutUntil(b.check_out_time) : null,
  ].filter((x): x is string => !!x);
  if (times.length)
    blocks.push({ key: "times", icon: <Clock />, title: t.terms.times, lines: times });
  for (const p of props) {
    const rules = rulesLines(p, t);
    if (rules.length)
      blocks.push({
        key: `rules-${p.id}`,
        icon: <ScrollText />,
        title: props.length > 1 ? `${t.terms.rules} — ${p.name}` : t.terms.rules,
        lines: rules,
      });
  }
  if (cancel.length || guestText)
    blocks.push({
      key: "cancel",
      icon: <CalendarX2 />,
      title: t.terms.cancellation,
      lines: cancel,
      text: guestText,
    });
  for (const p of props) {
    const parking = parkingLines(p, t);
    if (parking.length)
      blocks.push({
        key: `parking-${p.id}`,
        icon: <Car />,
        title: props.length > 1 ? `${t.terms.parking} — ${p.name}` : t.terms.parking,
        lines: parking,
        text: p.parking_instructions,
      });
    if (p.guest_info?.trim())
      blocks.push({
        key: `info-${p.id}`,
        icon: <Info />,
        title: props.length > 1 ? `${t.terms.info} — ${p.name}` : t.terms.info,
        lines: [],
        text: p.guest_info,
      });
  }
  if (blocks.length === 0) return null;
  const grid = (
    <div
      className={
        compact
          ? "gap-5 sm:columns-2 [&>article]:mb-5 [&>article]:break-inside-avoid"
          : "mt-14 gap-5 md:columns-2 [&>article]:mb-5 [&>article]:break-inside-avoid"
      }
    >
      {blocks.map((x) => (
        <article
          key={x.key}
          className="rounded-[var(--radius)] border border-border bg-card p-6 sm:p-8"
        >
          <h3 className="flex items-center gap-3 text-lg font-medium">
            <span className="text-[var(--site-gold-ink)] [&_svg]:size-5" aria-hidden="true">
              {x.icon}
            </span>
            {x.title}
          </h3>
          {x.lines.length > 0 && (
            <ul className="mt-4 space-y-2 text-[0.95rem] leading-relaxed text-foreground/85">
              {x.lines.map((l) => (
                <li key={l} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2.5 size-1 shrink-0 rounded-full bg-[var(--site-gold)]"
                  />
                  {l}
                </li>
              ))}
            </ul>
          )}
          {x.text && (
            <p className="mt-4 text-[0.95rem] leading-relaxed whitespace-pre-line text-muted-foreground">
              {x.text}
            </p>
          )}
        </article>
      ))}
    </div>
  );
  if (compact) return grid;
  return (
    <section id="terms" aria-labelledby="terms-title" className="scroll-mt-24 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          id="terms-title"
          eyebrow={section?.content.eyebrow ?? t.terms.title}
          title={section?.content.title ?? t.terms.subtitle}
          subtitle={section?.content.subtitle}
        />
        {grid}
        {b.booking_mode === "request" && (
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
            {t.terms.approval(b.approval_hours)}
          </p>
        )}
      </div>
    </section>
  );
}
