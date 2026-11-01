// טיוטות משפטיות לאתר (החלטת 01/11): מדיניות פרטיות והצהרת נגישות — תבניות שממלאות את פרטי
// העסק, מסומנות "טיוטה – טרם אושרה לפרסום" עד בדיקה משפטית, ולא נסרקות (noindex).
// התבנית כאן היא נקודת ההתחלה; עריכה ע"י העסק — בהמשך (הגדרות / עורך האתר, Stage 5).
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { useCopy } from "../copy";
import { longDate } from "../lib/format";
import {
  LEGAL_DRAFT_BANNER,
  accessibilitySections,
  privacySections,
  type LegalSection,
} from "../lib/legal";
import { useSite } from "../lib/site-context";

function LegalPage({ title, sections }: { title: string; sections: LegalSection[] }) {
  const { site } = useSite();
  const t = useCopy();
  return (
    <div className="bg-background pt-24 sm:pt-28">
      <article className="mx-auto max-w-3xl px-4 pb-20 sm:px-8">
        <p
          role="note"
          data-legal-draft=""
          className="mb-8 flex items-start gap-3 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {LEGAL_DRAFT_BANNER}
        </p>
        <h1 className="font-display text-3xl font-medium sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {site.business.name} · {longDate(site.today, t.locale)}
        </p>
        <div className="mt-10 space-y-8">
          {sections.map((s) => (
            <Section key={s.title} title={s.title}>
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </Section>
          ))}
        </div>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-medium">{title}</h2>
      <div className="space-y-2 leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  const t = useCopy();
  const { site } = useSite();
  return <LegalPage title={t.footer.privacy} sections={privacySections(site)} />;
}

export function AccessibilityPage() {
  const t = useCopy();
  const { site } = useSite();
  return <LegalPage title={t.footer.accessibility} sections={accessibilitySections(site)} />;
}
