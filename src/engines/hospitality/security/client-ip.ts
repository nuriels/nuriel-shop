// כתובת ה-IP של הגולש — המימוש עבר לשכבת הפלטפורמה (SEC-M2), כדי שגם הגבלות הקצב המשותפות
// (src/lib/rate-limit.server.ts) ישתמשו באותם כללים: X-Real-IP, אחרת ההופ האחרון ב-X-Forwarded-For.
export * from "@/platform/security/client-ip";
