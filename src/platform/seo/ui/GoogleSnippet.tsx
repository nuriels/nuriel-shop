// NURIEL AI SEO ENGINE — "איך זה ייראה בגוגל": a plain sketch of a search result (not Google's real rendering —
// the footnote says so). Titles / descriptions longer than what Google usually shows are cut like Google does.
import { cn } from "@/platform/ui";

const TITLE_MAX = 60;
const DESC_MAX = 155;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function GoogleSnippet(props: {
  title: string | null;
  description: string | null;
  url: string | null;
  className?: string;
  /** a word about what this is (default: a sketch, Google may show it differently) */
  note?: string | null;
}) {
  const title = props.title?.trim() || "(בלי כותרת — גוגל יבחר טקסט מהעמוד)";
  const description = props.description?.trim() || "(בלי תיאור — גוגל יבחר קטע מהעמוד)";
  let shown = props.url ?? "";
  try {
    if (props.url) {
      const u = new URL(props.url);
      shown = `${u.host}${u.pathname === "/" ? "" : decodeURI(u.pathname).replace(/\//g, " › ")}`;
    }
  } catch {
    shown = props.url ?? "";
  }
  return (
    <figure
      className={cn(
        "rounded-md border bg-white p-3 text-start text-[#202124] dark:bg-white",
        props.className,
      )}
      data-testid="google-snippet"
    >
      {shown && (
        <div dir="ltr" className="truncate text-left text-xs text-[#4d5156]">
          {shown}
        </div>
      )}
      <div dir="auto" className="text-base leading-snug text-[#1a0dab]">
        {cut(title, TITLE_MAX)}
      </div>
      <p dir="auto" className="mt-0.5 text-sm leading-snug text-[#4d5156]">
        {cut(description, DESC_MAX)}
      </p>
      {props.note !== null && (
        <figcaption className="mt-1 text-[11px] text-[#5f6368]">
          {props.note ?? "תצוגה משוערת — גוגל יכול להציג אחרת"}
        </figcaption>
      )}
    </figure>
  );
}
