// "SEO וגוגל" (NURIEL AI SEO ENGINE): מרכז ה-SEO של הפלטפורמה — הבדיקה הטכנית, ביטויי החיפוש, Search Console
// וההגדרות — עם ההצעות שממתינות לאישור (אותה רשימה של "גוגל ושיתוף" בעורך האתר: אישור, עריכה, לאחר כך,
// ביטול ושחזור). שום דבר לא משתנה באתר בלי אישור של העסק; שדות דף הבית נשמרים בטיוטה עד "פרסום".
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SeoCenter } from "@/platform/seo/ui/SeoCenter";
import { hospitalitySiteEditor, hospitalitySitePreview } from "../../api/site-editor.functions";
import { normalizeDesign } from "../../website/design/schema";
import { manageKeys } from "../lib/query-keys";
import { PageHeader } from "../ui/kit";
import { SeoProposalsPanel } from "../website/SeoProposalsPanel";

// אותם מפתחות כמו בעורך — הנתונים משותפים, ואישור כאן מרענן גם את העורך
const KEY = [...manageKeys.all, "site-editor"] as const;

function Proposals() {
  const editor = useQuery({ queryKey: KEY, queryFn: () => hospitalitySiteEditor(), retry: false });
  const preview = useQuery({
    queryKey: [...KEY, "site"],
    queryFn: () => hospitalitySitePreview(),
    retry: false,
  });
  if (editor.isPending || preview.isPending)
    return <p className="text-sm text-muted-foreground">טוענים את ההצעות…</p>;
  const d = editor.data;
  if (!d || !preview.data || (!d.draft && !d.published))
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        ההצעות לשיפור בגוגל יופיעו אחרי שתבחרו עיצוב לאתר —{" "}
        <Link to="/manage/website" className="font-medium underline">
          לעיצוב האתר
        </Link>
        .
      </p>
    );
  const design = normalizeDesign(
    d.draft?.document ?? d.published?.document ?? null,
    d.draft?.theme ?? d.published?.theme,
  );
  return (
    <div className="rounded-lg border bg-card p-4">
      <SeoProposalsPanel site={preview.data} design={design} />
    </div>
  );
}

export function SeoPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SEO וגוגל"
        description="איך האתר נראה בגוגל, מה כדאי לשפר, ונתונים אמיתיים מ-Google — בלי הבטחות לדירוג ובלי קיצורי דרך."
      />
      <SeoCenter variant="hospitality" proposals={<Proposals />} />
    </div>
  );
}
