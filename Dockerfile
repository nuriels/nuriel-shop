# ============================================================
# פורטל B2B להזמנת משקאות — kobi.nuri1.fit
# בנייה: docker compose build   הרצה: docker compose up -d
# ============================================================

# ---------- שלב 1: התקנת תלויות ובנייה ----------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./

# ה-lockfile של Lovable נועל 10 חבילות למירור פרטי (europe-west1-npm.pkg.dev)
# שאינו נגיש מחוץ לסביבת Lovable — מחליפים לרג'יסטרי הציבורי לפני ההתקנה.
RUN sed -i 's#https://europe-west1-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache#https://registry.npmjs.org#g' bun.lock \
 && bun install --no-progress

COPY . .

# ברירת המחדל של Lovable היא cloudflare-module; בשרת שלנו נדרש Node אמיתי.
ENV NITRO_PRESET=node-server
RUN bun run build

# ---------- שלב 2: הרצה רזה ----------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
