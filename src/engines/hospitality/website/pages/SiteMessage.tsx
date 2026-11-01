// הודעות של האתר: שגיאה בטעינה (למשל אתר שעוד לא נפתח) ועמוד שלא נמצא — בעיצוב של הערכה,
// גם כשנתוני האתר לא נטענו.
import { Link } from "@tanstack/react-router";
import { siteCopy } from "../copy";
import { DEFAULT_THEME, themeFor, themeStyle } from "../theme/themes";

function Message({ title, text, home }: { title: string; text: string; home: boolean }) {
  const t = siteCopy("he");
  return (
    <div
      dir={t.dir}
      lang={t.locale}
      style={themeStyle(themeFor(DEFAULT_THEME))}
      className="flex min-h-[70vh] items-center justify-center bg-background px-4 py-32 text-center text-foreground"
    >
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
  );
}

export function SiteError({ error }: { error: unknown }) {
  const t = siteCopy("he");
  const message = error instanceof Error ? error.message : "";
  if (message.includes("לא פתוח"))
    return <Message title={t.errors.notOpenTitle} text={t.errors.notOpen} home={false} />;
  return <Message title={t.errors.notOpenTitle} text={t.errors.generic} home={false} />;
}

export function SiteNotFound() {
  const t = siteCopy("he");
  return <Message title={t.errors.notFoundTitle} text={t.errors.notFound} home />;
}
