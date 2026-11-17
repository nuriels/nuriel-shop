# פריסה: "קידום, Analytics ומעקב" בהגדרות העסק (מיגרציה 199)

**הקומיט לפריסה:** `81848f9` (ענף `hospitality/tracking-settings`). הוא ממשיך את מה שרץ היום בייצור (`websites/engine`, `5b2daed`), כך שזה fast-forward.

**מה הפריסה כוללת:**

- מיגרציה 199 (`20261118100000_site_tracking_ga4`).
- הקוד החדש: שני הכרטיסים בהגדרות העסק, האתר קורא את GA4 מההגדרות, ואין טעינה כפולה של `gtag.js`.

**מה היא לא עושה:**

- לא מפעילה מדידה. המתג `hospitality_analytics_enabled` נשאר כבוי.
- לא משנה את הגדרות ההסכמה.
- לא שומרת אף מזהה.

**תוצאה:** אחרי הפריסה האתר של נופי דורית נראה ומתנהג בדיוק כמו היום.

## B — גיבוי, קוד ובנייה (האתר ממשיך לרוץ על הגרסה הקודמת)

```bash
B=/root/backups/nuriel-shop/before-tracking && mkdir -m 700 "$B" && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > "$B/db.dump" && docker exec -i nuriel-shop-db pg_restore -f /dev/null < "$B/db.dump" && echo "dump read to the end: ok ($(du -h "$B/db.dump" | cut -f1))" && echo "applied: $(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied")" && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-tracking && echo "rollback image before-tracking: ok" && cd /root/nuriel-shop-git && git rev-parse --short=7 HEAD > "$B/code-before.txt" && test -z "$(git status --porcelain --untracked-files=no)" && git fetch -q origin "+refs/heads/hospitality/tracking-settings:refs/remotes/origin/hospitality/tracking-settings" && git merge-base --is-ancestor HEAD 81848f9 && git merge-base --is-ancestor 81848f9 origin/hospitality/tracking-settings && echo "81848f9: fast-forward from $(cat "$B/code-before.txt"), on origin" && git checkout -q -B hospitality/tracking-settings 81848f9 && git log --oneline -1 && cp supabase/rollbacks/20261118100000_site_tracking_ga4.down.sql "$B/" && docker compose build > "$B/build.log" 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo ga4: \$(grep -rl save_my_ga4 /app/.output/server | wc -l) tag-manager: \$(grep -rl site_tag_manager /app/.output/server | wc -l)" || { echo "STOPPED"; tail -n 30 "$B/build.log" 2>/dev/null; }
```

**תקין:**

- `dump read to the end: ok (…)`
- `applied: 198`
- `rollback image before-tracking: ok`
- `81848f9: fast-forward from 5b2daed, on origin`
- שורת הקומיט
- `build ok`
- `ga4: … tag-manager: …` — שני מספרים גדולים מ-0

**`STOPPED`:** עוצרים ושולחים לי את הפלט. האתר לא נפגע, כי הקונטיינר שרץ לא מתחלף עד U.

## M — המיגרציה

```bash
cd /root/nuriel-shop-git && f=20261118100000_site_tracking_ga4 && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 81848f9 ] && [ "$n" = 198 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'site_tracking' AND column_name = 'ga4_measurement_id'), has_function_privilege('anon', 'public.site_ga4()', 'EXECUTE'), has_function_privilege('anon', 'public.save_my_ga4(text)', 'EXECUTE'), has_table_privilege('anon', 'public.site_tracking', 'SELECT'), (SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_analytics_enabled'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|t|f|f|f|199" ] && echo "tracking migration checks ok" && echo "GA4 copied from the editor: $(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT coalesce(string_agg(t.slug || '=' || s.ga4_measurement_id, ', '), 'none') FROM public.site_tracking s JOIN public.tenants t ON t.id = s.tenant_id WHERE s.ga4_measurement_id IS NOT NULL")" || echo "STOPPED"
```

**תקין:**

- `code 81848f9, applied before: 198`
- `20261118100000_site_tracking_ga4 ok`
- `1|t|t|f|f|f|199`. לפי הסדר:
  1. נרשמה רשומת מיגרציה אחת.
  2. העמודה נוספה.
  3. אורח קורא רק את המזהה של האתר שלו.
  4. אורח לא שומר.
  5. הטבלה סגורה לאורח.
  6. מתג המדידה **כבוי**.
  7. 199 מיגרציות.
- `tracking migration checks ok`
- `GA4 copied from the editor: none`, או מזהה שכבר היה שמור בעורך של אתר מסוים.

**בטוח לפני ההפעלה מחדש:** הגרסה שרצה עכשיו עדיין עובדת, כי `my_tag_manager` רק מחזירה שדה נוסף. המיגרציה עטופה ב-`BEGIN … COMMIT`, אז כישלון לא משאיר שום שינוי.

## U — הפעלה מחדש (זו הפריסה עצמה)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = 81848f9 ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && docker exec nuriel-shop-app printenv BUSINESS_PROFILE_ENGINE && for h in nofi-dorit.nuri1.fit/stay nuriel-shop.nuri1.fit/ efrat.nuri1.fit/; do printf '%s ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' "https://$h"; done && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:**

- `Up … (healthy)`
- `running the new image`
- `on` — מנוע האתרים נשאר דלוק.
- `nofi-dorit.nuri1.fit/stay 200`
- `nuriel-shop.nuri1.fit/ 200`
- `efrat.nuri1.fit/ 200`
- לוג ריק.

## V — בדיקה בדפדפן

1. ניהול נופי דורית → **הגדרות העסק** → גוללים ל-**"קידום, Analytics ומעקב"**. לחלופין ישירות: `https://nofi-dorit.nuri1.fit/manage/settings#tracking`.
2. מזינים את ה-`G-…` ולוחצים **"שמירת Google Analytics"**.
   - צפוי: "נשמר: G-…. המדידה באתר עדיין כבויה בפלטפורמה — המזהה ייטען רק אחרי שתופעל".
3. בדיקה בשרת (קריאה בלבד) שהמזהה שמור לנופי דורית בלבד:

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT t.slug || ' = ' || s.ga4_measurement_id FROM public.site_tracking s JOIN public.tenants t ON t.id = s.tenant_id WHERE s.ga4_measurement_id IS NOT NULL"
```

צפוי: שורה אחת, `nofi-dorit = G-…`.

4. באתר עצמו לא משתנה כלום עד הפעלת המדידה, באישור נפרד. לפני ההפעלה צריך לעדכן את מדיניות הפרטיות.

## חזרה לאחור (רק בתקלה, ובאישור)

**R1 — האפליקציה:** חוזרים לגרסה הקודמת. המיגרציה יכולה להישאר, כי הגרסה הקודמת עובדת איתה.

```bash
docker tag nuriel-shop-app-app:before-tracking nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q -B websites/engine "$(cat /root/backups/nuriel-shop/before-tracking/code-before.txt)" && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**R2 — גם המסד:** רק אחרי R1. המיגרציה נעצרת מעצמה אם כבר נשמר מזהה GA4.

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-tracking/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-tracking/20261118100000_site_tracking_ga4.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261118100000_site_tracking_ga4.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"
```

**תקין:** `backup ok`, ואחריו `198`.
