# syntax=docker/dockerfile:1
# ============================================================
# פורטל B2B להזמנת משקאות — SaaS מרובה חנויות (Coolify)
# בנייה: Coolify (Docker Compose build pack) או docker compose build
# ============================================================

# ---------- שלב 1: התקנת תלויות ----------
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./

# cache mount: בנייה חוזרת ב-Coolify לא מורידה שוב את כל החבילות.
# --frozen-lockfile: בדיוק הגרסאות שב-bun.lock, בלי עדכונים שקטים.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --no-progress

# ---------- שלב 2: בנייה ----------
FROM deps AS build
WORKDIR /app

# משתני VITE_* נאפים לבאנדל הדפדפן בזמן הבנייה (import.meta.env) — לכן הם
# build args ולא משתני ריצה. אלה ערכים ציבוריים (URL + anon key), לא סודות.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}

COPY . .

# בלי הערכים האלה הבאנדל נבנה "בהצלחה" אבל כל בקשה מהדפדפן נופלת — עוצרים כאן.
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
 || (echo "Missing build args VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY" >&2; exit 1)

# vite.config.ts בונה שרת Node עצמאי (Nitro preset: node-server)
RUN bun run build

# ---------- שלב 3: הרצה רזה ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Nitro מייצר שרת עצמאי (כולל node_modules שנדרשים בפועל) — אין צורך בשאר הקוד.
COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

# R-4: /healthz עונה מהתהליך עצמו — בלי מסד, בלי זיהוי חנות — כך ש-Coolify / Docker לא מורידים את האפליקציה
# רק כי ה-DB איטי או נפל לרגע. מוכנות המסד נבדקת ב-/readyz (לניטור ולסקריפט הפריסה, לא להפעלה מחדש).
# הגיבוי ל-/robots.txt קיים רק כדי שתמונה מלפני השינוי (חזרה לאחור) תמשיך להיחשב תקינה; בגרסה החדשה
# /healthz עונה מיד ולא מגיעים אליו.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const u='http://127.0.0.1:'+(process.env.PORT||3000),ok=p=>fetch(u+p).then(r=>r.ok).catch(()=>false);ok('/healthz').then(a=>a||ok('/robots.txt')).then(a=>process.exit(a?0:1))"

CMD ["node", ".output/server/index.mjs"]
