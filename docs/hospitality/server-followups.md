# משימות פתוחות לשרת — לפקודות הבאות

> אותו נוהל: פקודה אחת בכל פעם, שמות מלאים, בלי משתני מעטפת, שום פקודה לא מדפיסה סוד.
> הפקודות כאן — קריאה בלבד, אלא אם כתוב אחרת.

## 1. תעודת SSL לכתובת חדשה לוקחת הרבה זמן (דווח 2 בנובמבר 2026)

**מה קרה:** בפתיחת צימר מהשער ("נופי דורית") הכול זרם עד "מאבטחים את הכתובת (תעודת SSL)", ושם זה
לקח הרבה זמן — לרגע נראה תקוע.

**איך זה עובד היום** (`deploy/ssl/`):
- הטיימר `nuriel-store-certs.timer` מריץ את `store-certs.sh` כל דקה (`OnUnitActiveSec=1min`,
  `AccuracySec=10s`).
- ריצה שמוצאת כתובת חדשה בלי תעודה מנפיקה אותה מ-Let's Encrypt (`certbot certonly --webroot`,
  HTTP-01), ומדווחת למסד (`ssl_agent_report`) — רק אחרי שעברה על כל הכתובות. אחרי זה היא כותבת מחדש
  את בלוק ה-443 של nginx וטוענת אותו.
- השער בודק כל 4 שניות; אחרי 2.5 דקות מציע "להיכנס בכל זאת".
- **צפוי:** דקה-שתיים. **אחרי הנפקה שנכשלה:** ניסיון חוזר רק אחרי שעה (`RETRY_AFTER_SECONDS=3600`),
  והשער מציג את השגיאה.

**הפקודה הראשונה בפעם הבאה — אבחון (קריאה בלבד; כל הזמנים ב-UTC):**

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, to_char(t.created_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI:SS') AS opened_utc, s.status, to_char(s.checked_at AT TIME ZONE 'UTC', 'DD/MM HH24:MI:SS') AS checked_utc, left(s.last_error, 120) AS error FROM public.tenants t LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id WHERE t.created_at > now() - interval '3 days' ORDER BY t.created_at DESC LIMIT 6" && systemctl list-timers nuriel-store-certs.timer --no-pager && journalctl -u nuriel-store-certs.service --since "-24h" --utc --no-pager -o short-iso | grep -E "מנפיק|הונפקה|נכשל|✗" | tail -30
```

**מה מחפשים:**
- כמה זמן עבר בין `opened_utc` של העסק לשורה "מנפיק תעודה ל-…" (הטיימר) ול-"✓ תעודה הונפקה" (certbot);
- האם הייתה שורת "✗ ההנפקה … נכשלה" (ואז ניסיון חוזר רק אחרי שעה);
- האם הטיימר באמת רץ כל דקה (`list-timers`: LAST / NEXT).

**כיוונים לתיקון — אחרי האבחון:**
- אם זה רק הטיימר + certbot (דקה-שתיים): טקסט מדויק יותר בשער, או ריצה מיידית של הסקריפט כשעסק נפתח.
- **פתרון קבוע:** תעודה אחת לכל תתי-הדומיין (`*.nuri1.fit`, אימות DNS-01) — כתובת חדשה, של חנות או
  של צימר, לא מחכה בכלל. דורש גישה ל-API של ספק ה-DNS. החלטה של בעל הפלטפורמה.
- **לבדוק גם:** הדיווח "active" יוצא לפני שבלוק ה-443 החדש נטען ב-nginx — חלון של שניות שבו הכניסה
  עלולה להראות אזהרת אבטחה.
