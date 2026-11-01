// מתאם נתיב (Hospitality): כניסה לאזור הניהול (מחוץ למעטפת — בלי בדיקת הרשאה)
import { createFileRoute } from "@tanstack/react-router";
import { manageLoginRoute } from "@/engines/hospitality/management/routes";

export const Route = createFileRoute("/manage_/login")(manageLoginRoute);
