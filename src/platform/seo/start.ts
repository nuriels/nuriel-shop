// NURIEL AI SEO ENGINE — starting the worker from the composition root (which is loaded in the browser too).
// Server only: in the browser build the body of the function is removed, so the worker (site checks,
// Search Console, the database calls) never enters the browser bundle. A failure here is logged and never
// takes the app server down — the shop and the sites keep working without the SEO engine.
import { createServerOnlyFn } from "@tanstack/react-start";

export const startSeoWorkerOnServer = createServerOnlyFn(async () => {
  try {
    const { startSeoWorker } = await import("./worker.server");
    startSeoWorker();
  } catch (e) {
    console.error("[seo] worker did not start", e instanceof Error ? e.message : String(e));
  }
});
