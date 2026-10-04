import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { BlockedPage } from "@/lib/blocked-pages";

/** עמוד חסימה מעוצב (403) — אותו עיצוב כמו ה-HTML שהשרת מחזיר בטעינה ראשונה */
export function BlockedPageView({
  page,
  action,
}: {
  page: BlockedPage;
  /** search — למשל { tab: "billing" }: חנות שהמנוי שלה פג נכנסת ישר ל"המנוי שלי" */
  action: { to: "/" | "/admin"; label: string; search?: { tab: string } };
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 px-4">
      <main className="w-full max-w-md rounded-2xl bg-card px-8 py-10 text-center shadow-lg">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-destructive/10">
          <Lock className="size-7 text-destructive" />
        </div>
        <div className="text-xs font-bold tracking-widest text-destructive">403</div>
        <h1 className="mt-1 mb-3 text-2xl font-bold">{page.title}</h1>
        <p className="text-muted-foreground">{page.message}</p>
        <p className="mt-2 text-sm text-muted-foreground">{page.note}</p>
        <Link
          to={action.to}
          search={action.search ?? true}
          className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {action.label}
        </Link>
      </main>
    </div>
  );
}
