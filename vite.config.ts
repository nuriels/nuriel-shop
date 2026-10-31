import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  server: { host: "::", port: 8080 },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // src/server.ts: מעטפת ה-SSR שלנו (זיהוי חנות + דף שגיאה)
      server: { entry: "server" },
      // קוד שרת (תיקיות server/ ו-server-only) לא ייכנס לבאנדל הדפדפן
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // שרת Node עצמאי (.output/server/index.mjs) — מה שרץ בקונטיינר
    ...(command === "build"
      ? [
          nitro({
            preset: "node-server",
            // סביבת הריצה של TanStack Start בשרת (ה-handler, פונקציות השרת, CSRF,
            // middleware) — תמיד בחלק (chunk) אחד. אחרת החלוקה תלויה ב-hash של הקבצים,
            // ולפעמים נוצר מעגל בין שני חלקים והשרת נופל בעלייה
            // ("createCsrfMiddleware is not a function" — Hospitality Stage 2a)
            rolldownConfig: {
              output: {
                codeSplitting: {
                  groups: [
                    {
                      name: "_tanstack-start-runtime",
                      priority: 100,
                      test: /[\\/]\.nitro[\\/]vite[\\/]services[\\/]ssr[\\/]assets[\\/](server|createServerFn|createCsrfMiddleware|createMiddleware|__23tanstack-start-server-fn-resolver)-[\w-]+\.js$/,
                    },
                  ],
                },
              },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
