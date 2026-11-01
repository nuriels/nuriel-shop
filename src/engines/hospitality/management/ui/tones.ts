// גוונים סמנטיים של אזור הניהול (שלב F2) — מחלקות Tailwind מעל הטוקנים של manage.css (--hm-*).
// במקום צבעים קשיחים (amber / emerald / rose…) בכל מסך: גוון אחד לכל משמעות.
export type Tone = "brand" | "champagne" | "success" | "warning" | "danger" | "info" | "neutral";

export const TONES: Record<Tone, { text: string; bg: string; dot: string; border: string }> = {
  brand: {
    text: "text-[var(--hm-lagoon-700)]",
    bg: "bg-[var(--hm-lagoon-100)]",
    dot: "bg-[var(--hm-lagoon-500)]",
    border: "border-[var(--hm-lagoon-100)]",
  },
  champagne: {
    text: "text-[var(--hm-champagne-700)]",
    bg: "bg-[var(--hm-champagne-100)]",
    dot: "bg-[var(--hm-champagne-600)]",
    border: "border-[var(--hm-champagne-100)]",
  },
  success: {
    text: "text-[var(--hm-success)]",
    bg: "bg-[var(--hm-success-bg)]",
    dot: "bg-[var(--hm-success-dot)]",
    border: "border-[var(--hm-success-bg)]",
  },
  warning: {
    text: "text-[var(--hm-warning)]",
    bg: "bg-[var(--hm-warning-bg)]",
    dot: "bg-[var(--hm-warning-dot)]",
    border: "border-[var(--hm-warning-bg)]",
  },
  danger: {
    text: "text-[var(--hm-danger)]",
    bg: "bg-[var(--hm-danger-bg)]",
    dot: "bg-[var(--hm-danger-dot)]",
    border: "border-[var(--hm-danger-bg)]",
  },
  info: {
    text: "text-[var(--hm-info)]",
    bg: "bg-[var(--hm-info-bg)]",
    dot: "bg-[var(--hm-info-dot)]",
    border: "border-[var(--hm-info-bg)]",
  },
  neutral: {
    text: "text-[var(--hm-neutral)]",
    bg: "bg-[var(--hm-neutral-bg)]",
    dot: "bg-[var(--hm-neutral)]",
    border: "border-border",
  },
};
