import { Link } from "@tanstack/react-router";

/** שני נרות שבת — SVG מצויר (בלי תלות בספריית אייקונים) */
function Candles() {
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 sm:h-32 sm:w-32" aria-hidden="true">
      <defs>
        <radialGradient id="sabbath-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sabbath-flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff7d6" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      {[38, 82].map((x) => (
        <g key={x}>
          <circle cx={x} cy="30" r="20" fill="url(#sabbath-glow)" className="sabbath-glow" />
          <path
            d={`M${x} 16 C ${x + 7} 26, ${x + 6} 34, ${x} 40 C ${x - 6} 34, ${x - 7} 26, ${x} 16 Z`}
            fill="url(#sabbath-flame)"
            className="sabbath-flame"
            style={{ transformOrigin: `${x}px 40px` }}
          />
          <rect x={x - 1} y="38" width="2" height="6" rx="1" fill="#3f3f46" />
          <rect x={x - 9} y="44" width="18" height="58" rx="3" fill="#fafaf9" />
          <rect x={x - 9} y="44" width="5" height="58" rx="2" fill="#e7e5e4" />
          <rect x={x - 14} y="100" width="28" height="8" rx="3" fill="#d6a756" />
        </g>
      ))}
    </svg>
  );
}

/**
 * מסך "שבת שלום" על כל המסך — מוצג ללקוחות ולאורחים כשמצב שבת דולק בחנות.
 * אין בו קטלוג ואין שום פעולת קנייה; גם במסד הזמנה חדשה נחסמת בשבת.
 */
export function SabbathScreen({ storeName }: { storeName: string }) {
  return (
    <main
      className="surface-cellar relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-center"
      aria-labelledby="sabbath-title"
    >
      {/* הילה רכה סביב הנרות */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-2/3 opacity-60"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 30%, rgb(253 230 138 / 0.22) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />
      <div className="relative flex max-w-xl flex-col items-center">
        <Candles />
        <p className="mt-6 text-sm font-medium tracking-widest opacity-70">{storeName}</p>
        <h1
          id="sabbath-title"
          className="font-display mt-3 text-5xl font-bold leading-tight sm:text-6xl"
        >
          שבת שלום
        </h1>
        <div className="my-6 h-px w-24 bg-current opacity-30" aria-hidden="true" />
        <p className="text-lg leading-8 opacity-90 sm:text-xl">
          האתר שומר שבת ויחזור לפעילות במוצאי שבת.
        </p>
        <p className="mt-2 text-sm opacity-70">אפשר להמשיך להזמין מיד בצאת השבת.</p>
      </div>
      <Link
        to="/login"
        className="absolute bottom-5 text-xs underline-offset-4 opacity-50 hover:underline hover:opacity-80"
      >
        כניסת צוות החנות
      </Link>
    </main>
  );
}
