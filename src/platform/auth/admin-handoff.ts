// מתאם (adapter): "היכנס לניהול" של מנהל הפלטפורמה — קוד כניסה חד-פעמי לאתר (src/lib/handoff.functions,
// הקיים; נבדק שהמשתמש מנהל פלטפורמה, מוגבל בקצב ונרשם בתיק הלקוח) ופתיחת /admin-handoff באתר.
// שלב א' 4: אתרי האירוח יצאו מרשימת החנויות — אותה כניסה מכרטיס האתר במסך "אתרי אירוח".
export { createStoreAdminHandoff as createAdminHandoff } from "@/lib/handoff.functions";
