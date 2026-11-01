// הודעות של האתר: שגיאה בטעינה (למשל אתר שעוד לא נפתח) ועמוד שלא נמצא — בעיצוב של הערכה,
// גם כשנתוני האתר לא נטענו. בתחתית: קרדיט נוריאל הקבוע (F1), כמו בכל עמוד של האתר.
import { Link } from "@tanstack/react-router";
import { NurielCredit } from "@/platform/branding/NurielCredit";
import { siteCopy } from "../copy";
import { DEFAULT_THEME, themeFor, themeStyle } from "../theme/themes";

function Message({ title, text, home }: { title: string; text: string; home: boolean }) {
  const t = siteCopy("he");
  return (
    <div
      dir={t.dir}
      lang={t.locale}
      style={themeStyle(themeFor(DEFAULT_THEME))}
      className="flex min-h-screen flex-col bg-background text-foreground"
      data-site-message=""
    >
      <div className="flex flex-1 items-center justify-center px-4 py-32 text-center">
        <div className="max-w-md">
          <span aria-hidden="true" className="mx-auto mb-8 block h-px w-14 bg-[var(--site-gold)]" />
          <h1 className="font-display text-3xl font-medium sm:text-4xl">{title}</h1>
          <p className="mt-4 text-muted-foreground">{text}</p>
          {home && (
            <Link
              to="/stay"
              className="mt-8 inline-flex h-11 items-center rounded-sm bg-primary px-6 text-sm font-medium text-primary-foreground"
            >
              {t.errors.home}
            </Link>
          )}
        </div>
      </div>
      <footer className="bg-[var(--site-deep)] text-[var(--site-deep-foreground)]">
        <NurielCredit className="mx-auto flex max-w-7xl justify-center px-4 py-5 text-xs" />
      </footer>
    </div>
  );
}

export function SiteError({ error }: { error: unknown }) {
  const t = siteCopy("he");
  const message = error instanceof Error ? error.message : "";
  if (message.includes("לא פתוח"))
    return <Message title={t.errors.notOpenTitle} text={t.errors.notOpen} home={false} />;
  return <Message title={t.errors.notOpenTitle} text={t.errors.generic} home={false} />;
}

export function SiteNotFound({ data }: { data?: unknown }) {
  const t = siteCopy("he");
  if ((data as { closed?: boolean } | undefined)?.closed)
    return <Message title={t.errors.notOpenTitle} text={t.errors.notOpen} home={false} />;
  return <Message title={t.errors.notFoundTitle} text={t.errors.notFound} home />;
}
