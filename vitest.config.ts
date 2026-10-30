import { defineConfig } from "vitest/config";

// בדיקות יחידה (שלב 0): נפרד מ-vite.config.ts כדי לא לטעון את התוספים של
// TanStack Start / Nitro. בלי חיבור למסד — ערכי סביבה פיקטיביים בלבד.
export default defineConfig({
  resolve: { alias: { "@": `${process.cwd()}/src` } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    env: {
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_PUBLISHABLE_KEY: "unit-test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "unit-test-service-key",
    },
  },
});
