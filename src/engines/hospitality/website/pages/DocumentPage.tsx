// מסמכי האתר (מיגרציה 60) באתר: הגרסה שבעל העסק פרסם — הטקסט המלא, תאריך העדכון והגרסה.
// מדיניות פרטיות שלא פורסמה — הטיוטה הכללית (כמו קודם, מסומנת כטיוטה); הצהרת נגישות שלא פורסמה —
// עמוד קצר עם הדרך לפנות בנושא נגישות, בלי שום הצהרה שהאתר עומד בתקן; מסמך אחר שלא פורסם — 404.
import { useLoaderData } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { DocumentBody } from "../../documents/DocumentBody";
import type { PublicDocument } from "../../types/documents";
import { useCopy } from "../copy";
import { longDate } from "../lib/format";
import { LEGAL_DRAFT_BANNER, accessibilityFallback, privacySections } from "../lib/legal";
import { useSite } from "../lib/site-context";

function Article({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background pt-24 sm:pt-28">
      <article className="mx-auto max-w-3xl px-4 pb-20 sm:px-8">{children}</article>
    </div>
  );
}

/** מסמך שפורסם */
export function PublishedDocument({ doc }: { doc: PublicDocument }) {
  const t = useCopy();
  const { site } = useSite();
  return (
    <Article>
      <h1 className="font-display text-3xl font-medium sm:text-4xl">{doc.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="document-updated">
        {site.business.name} · {t.docs.updated(longDate(doc.published_at.slice(0, 10), t.locale))} ·{" "}
        {t.docs.version(doc.version)}
      </p>
      <div className="mt-10 text-foreground/90">
        <DocumentBody text={doc.body} headingClassName="mb-3 mt-8 text-xl font-medium first:mt-0" />
      </div>
    </Article>
  );
}

function DraftBanner() {
  return (
    <p
      role="note"
      data-legal-draft=""
      className="mb-8 flex items-start gap-3 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      {LEGAL_DRAFT_BANNER}
    </p>
  );
}

export function PrivacyPage() {
  const doc = useLoaderData({ strict: false }) as PublicDocument | null | undefined;
  const t = useCopy();
  const { site } = useSite();
  if (doc) return <PublishedDocument doc={doc} />;
  return (
    <Article>
      <DraftBanner />
      <h1 className="font-display text-3xl font-medium sm:text-4xl">{t.footer.privacy}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{site.business.name}</p>
      <div className="mt-10 space-y-8">
        {privacySections(site).map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 text-xl font-medium">{s.title}</h2>
            <div className="space-y-2 leading-relaxed text-foreground/85">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Article>
  );
}

export function AccessibilityPage() {
  const doc = useLoaderData({ strict: false }) as PublicDocument | null | undefined;
  const t = useCopy();
  const { site } = useSite();
  if (doc) return <PublishedDocument doc={doc} />;
  const f = accessibilityFallback(site);
  return (
    <Article>
      <h1 className="font-display text-3xl font-medium sm:text-4xl">{t.footer.accessibility}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{site.business.name}</p>
      <div className="mt-10 space-y-8" data-testid="accessibility-fallback">
        {f.map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 text-xl font-medium">{s.title}</h2>
            <div className="space-y-2 leading-relaxed text-foreground/85">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Article>
  );
}

/** /stay/docs/<slug> — רק מסמך שפורסם (אחרת ה-loader מחזיר 404) */
export function SiteDocumentPage() {
  const doc = useLoaderData({ strict: false }) as PublicDocument;
  return <PublishedDocument doc={doc} />;
}
