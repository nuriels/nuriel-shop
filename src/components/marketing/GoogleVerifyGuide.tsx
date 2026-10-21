import { BookOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CONSOLE_URL = "https://search.google.com/search-console";
const HELP_URL = "https://support.google.com/webmasters/answer/9008080?hl=he";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-semibold">{title}</p>
        <div className="space-y-1.5 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/**
 * מדריך קצר לאימות בעלות ב-Google Search Console והגשת מפת האתר — נפתח מכפתור "מדריך"
 * בכרטיס האימות. הכתובות בדוגמאות הן של החנות הנוכחית (origin), לא קבועות.
 */
export function GoogleVerifyGuide({ origin }: { origin: string }) {
  const site = origin || "https://החנות-שלכם";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="gsc-guide-open">
          <BookOpen className="size-4" />
          מדריך
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="text-start">
          <DialogTitle>מדריך: חיבור החנות ל-Google Search Console</DialogTitle>
          <DialogDescription>
            שלושה שלבים, כ-10 דקות. כך החנות שלכם תופיע בחיפוש בגוגל, ותוכלו לראות אילו עמודים גוגל
            מכירה.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-5">
          <Step n={1} title="הרשמה ל-Google Search Console">
            <p>הכלי הרשמי והחינמי של גוגל לבעלי אתרים.</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>
                היכנסו ל-
                <a
                  href={CONSOLE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  Google Search Console <ExternalLink className="size-3" />
                </a>{" "}
                עם חשבון הגוגל שלכם ולחצו &quot;התחל עכשיו&quot;.
              </li>
              <li>
                בחרו באפשרות <b>&quot;קידומת כתובת אתר&quot; (URL prefix)</b> (ולא
                &quot;דומיין&quot;), והזינו את הכתובת המלאה של החנות, כולל https:
                <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs" dir="ltr">
                  {site}
                </code>
              </li>
              <li>לחצו &quot;המשך&quot;. גוגל תציג את מסך &quot;אימות בעלות&quot;.</li>
            </ul>
          </Step>

          <Step n={2} title="אימות הבעלות על האתר">
            <p>
              כאן מוכיחים לגוגל שהאתר שלכם. בחרו <b>אחת</b> משתי השיטות, והזינו את הערך בכרטיס
              &quot;אימות בעלות&quot; שנמצא מעל המדריך הזה.
            </p>
            <ul className="list-disc space-y-1 ps-5">
              <li>
                <b>תג HTML (הכי קל):</b> בחרו &quot;תג HTML&quot; והעתיקו את השורה שגוגל נותנת, כמו{" "}
                <code className="text-xs" dir="ltr">
                  &lt;meta name=&quot;google-site-verification&quot; content=&quot;…&quot; /&gt;
                </code>
                . הדביקו אותה בשדה &quot;תג HTML&quot; (אפשר את כל השורה או רק את הערך שב-content).
              </li>
              <li>
                <b>קובץ HTML:</b> גוגל תציע להוריד קובץ בשם כמו google1234abcd.html. אין צורך להעלות
                אותו. הקלידו רק את שמו בשדה &quot;קובץ HTML&quot;, והחנות תגיש אותו לבד.
              </li>
            </ul>
            <p>
              לחצו <b>&quot;שמירה&quot;</b> בפאנל, ורק אחר כך חזרו לגוגל ולחצו{" "}
              <b>&quot;אימות&quot;</b>. תופיע הודעה ירוקה &quot;הבעלות אומתה בהצלחה&quot;.
            </p>
            <p className="font-medium text-foreground">
              אחרי האימות אל תמחקו את התג או את שם הקובץ. גוגל בודקת אותם מדי פעם.
            </p>
          </Step>

          <Step n={3} title="הגשת מפת האתר (Sitemap)">
            <p>
              מפת האתר מראה לגוגל את כל עמודי החנות: דף הבית, הקטגוריות והמוצרים. היא נוצרת ומתעדכנת
              אוטומטית, ואין צורך ליצור אותה.
            </p>
            <ul className="list-disc space-y-1 ps-5">
              <li>בתפריט הצדדי ב-Search Console לחצו &quot;מפות אתר&quot; (Sitemaps).</li>
              <li>
                בשדה &quot;הוספת מפת אתר חדשה&quot; הקלידו{" "}
                <code className="text-xs" dir="ltr">
                  sitemap.xml
                </code>{" "}
                ולחצו &quot;שליחה&quot;. הכתובת המלאה:
                <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs" dir="ltr">
                  {site}/sitemap.xml
                </code>
              </li>
              <li>
                הסטטוס ישתנה ל&quot;הצליח&quot; (Success) וגוגל תציג כמה עמודים מצאה. זה יכול לקחת
                עד כמה ימים.
              </li>
            </ul>
          </Step>
        </ol>

        <p className="text-xs text-muted-foreground">
          כל חנות מאמתת את הדומיין שלה בנפרד. למידע נוסף:{" "}
          <a
            href={HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline"
          >
            העזרה הרשמית של גוגל <ExternalLink className="size-3" />
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
