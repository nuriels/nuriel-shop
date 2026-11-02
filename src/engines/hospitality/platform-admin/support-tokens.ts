// הטוקנים של אזור הניהול (manage.css) לתיבת התמיכה שבפאנל הפלטפורמה (E4): manage.css נטען רק
// במסכי /manage, ורכיבי השרשור המשותפים משתמשים בטוקנים — כאן הם מוגדרים רק בתוך התיבה,
// בלי לשנות את שאר הפאנל.
import type { CSSProperties } from "react";

export const SUPPORT_TOKENS = {
  "--hm-lagoon-900": "#0c302f",
  "--hm-lagoon-700": "#0e3b3a",
  "--hm-lagoon-500": "#1f6f6b",
  "--hm-lagoon-100": "#e3eeec",
  "--hm-lagoon-50": "#f0f6f5",
  "--hm-champagne-500": "#d8b87a",
  "--hm-champagne-600": "#b8935a",
  "--hm-champagne-700": "#7a5d27",
  "--hm-champagne-100": "#f7f0e1",
  "--hm-surface-2": "#faf8f4",
  "--hm-line-soft": "#efeae2",
  "--hm-success": "#1e6b4e",
  "--hm-success-bg": "#e5f2eb",
  "--hm-success-dot": "#2e9a6b",
  "--hm-warning": "#8a5300",
  "--hm-warning-bg": "#fff1db",
  "--hm-warning-dot": "#d99a2b",
  "--hm-danger": "#9a3a2b",
  "--hm-danger-bg": "#fbede9",
  "--hm-danger-dot": "#c9553f",
  "--hm-info": "#1f4e8c",
  "--hm-info-bg": "#e7eef6",
  "--hm-info-dot": "#3d72b8",
  "--hm-neutral": "#4e5b58",
  "--hm-neutral-bg": "#f0ede7",
  "--hm-shadow-card": "0 1px 2px rgb(12 48 47 / 0.04), 0 10px 24px -18px rgb(12 48 47 / 0.3)",
} as CSSProperties;
