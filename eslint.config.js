import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const SERVER_ONLY = {
  name: "server-only",
  message:
    "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
};

// גבולות בין המנועים (Hospitality Stage 1f, plan B1): platform ← מנועים ← שורש ההרכבה.
// מותר: ecommerce → platform, hospitality → platform, app → הכל.
// אסור: ecommerce ↔ hospitality, platform → מנועים / שורש ההרכבה / קוד מוצר.
// בדיקת הארכיטקטורה (tests/architecture) אוכפת את אותם כללים גם על import דינמי ויחסי.
// group: רשימת תבניות (gitignore), או { regex } כשצריך רשימת היתרים מדויקת (מתאמים)
const boundary = (files, ignores, group, message, dynamicImport) => ({
  files,
  ignores,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [SERVER_ONLY],
        patterns: [Array.isArray(group) ? { group, message } : { regex: group.regex, message }],
      },
    ],
    // import() דינמי — no-restricted-imports לא בודק אותו
    "no-restricted-syntax": [
      "error",
      { selector: `ImportExpression[source.value=${dynamicImport}]`, message },
    ],
  },
});
const PRODUCT_CODE = [
  "@/routes",
  "@/routes/**",
  "@/components",
  "@/components/**",
  "@/hooks",
  "@/hooks/**",
  "@/lib",
  "@/lib/**",
  "@/server",
  "@/server/**",
];

// מתאמי הפלטפורמה שעוטפים מודול קיים (Stage 2a): רשימה סגורה, וכל אחד רק את המודול שלו
// (כמו PLATFORM_ADAPTERS ב-tests/architecture/boundaries.test.ts)
const PLATFORM_UI_ADAPTER = ["src/platform/ui/**/*.{ts,tsx}"];
const PLATFORM_AUTH_ADAPTERS = [
  "src/platform/auth/browser-session.ts",
  "src/platform/auth/login.ts",
  "src/platform/security/rate-limit.server.ts",
];
// מתאמי הנתיבים של Hospitality: קבצי src/routes שהמסגרת דורשת, ונחשבים קוד של המנוע
const HOSPITALITY_ROUTES = [
  "src/routes/manage.tsx",
  "src/routes/manage.*.tsx",
  "src/routes/manage_.*.tsx",
];
// ה-root של הנתבים: כמו קובץ כניסה — מגיע למנועים רק דרך שורש ההרכבה
const ROOT_ROUTE = "src/routes/__root.tsx";
const PLATFORM_FORBIDDEN = [
  "@/engines",
  "@/engines/**",
  "@/app",
  "@/app/**",
  ...PRODUCT_CODE,
  "../../**",
];
const PLATFORM_MESSAGE =
  "The platform must not import an engine, the composition root or product code — add an adapter in src/platform instead.";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": ["error", { paths: [SERVER_ONLY] }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  boundary(
    ["src/platform/**/*.{ts,tsx}"],
    [],
    PLATFORM_FORBIDDEN,
    PLATFORM_MESSAGE,
    "/^@\\/(engines|app|routes|components|hooks|lib|server)(\\/|$)|^\\.\\.\\/\\.\\.\\//",
  ),
  // מתאם ערכת הממשק: רק src/components/ui/*, cn ו-use-mobile
  boundary(
    PLATFORM_UI_ADAPTER,
    [],
    {
      regex:
        "^@/(?!components/ui/[\\w-]+$|lib/utils$|hooks/use-mobile$)(engines|app|routes|components|hooks|lib|server)(/|$)|^\\.\\./\\.\\./",
    },
    PLATFORM_MESSAGE,
    "/^@\\/(engines|app|routes|components|hooks|lib|server)(\\/|$)|^\\.\\.\\/\\.\\.\\//",
  ),
  // מתאמי ההתחברות: רק פונקציות הכניסה המשותפות (סיסמה, קוד במייל)
  boundary(
    PLATFORM_AUTH_ADAPTERS,
    [],
    {
      regex:
        "^@/(?!lib/auth\\.functions$|lib/login-code\\.functions$|lib/rate-limit\\.server$)(engines|app|routes|components|hooks|lib|server)(/|$)|^\\.\\./\\.\\./",
    },
    PLATFORM_MESSAGE,
    "/^@\\/(engines|app|routes|components|hooks|lib|server)(\\/|$)|^\\.\\.\\/\\.\\.\\//",
  ),
  boundary(
    ["src/engines/hospitality/**/*.{ts,tsx}", ...HOSPITALITY_ROUTES],
    [],
    {
      regex:
        "^@/(?!platform(/|$)|engines/hospitality(/|$))|(^|/)ecommerce(/|$)|(^|/)app(/|$)|^\\.\\./\\.\\./\\.\\./",
    },
    "The Hospitality engine may import only its own code and the platform (src/platform).",
    "/^@\\/(?!platform(\\/|$)|engines\\/hospitality(\\/|$))|ecommerce\\/|(^|\\/)app\\/|^\\.\\.\\/\\.\\.\\/\\.\\.\\//",
  ),
  boundary(
    ["src/**/*.{ts,tsx}"],
    [
      "src/platform/**",
      "src/engines/hospitality/**",
      "src/app/**",
      "src/start.ts",
      "src/server.ts",
      ROOT_ROUTE,
      ...HOSPITALITY_ROUTES,
    ],
    [
      "@/engines/hospitality",
      "@/engines/hospitality/**",
      "**/engines/hospitality/**",
      "@/app",
      "@/app/**",
    ],
    "Ecommerce code must not import the Hospitality engine or the composition root.",
    "/engines\\/hospitality|^@\\/app(\\/|$)/",
  ),
  boundary(
    ["src/start.ts", "src/server.ts", ROOT_ROUTE],
    [],
    [
      "@/engines/hospitality",
      "@/engines/hospitality/**",
      "**/engines/hospitality/**",
      "./engines/**",
    ],
    "Entry files reach the engines only through the composition root (src/app/engines.ts).",
    "/engines\\/hospitality|^\\.\\/engines\\//",
  ),
  eslintPluginPrettier,
);
