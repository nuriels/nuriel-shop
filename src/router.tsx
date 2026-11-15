import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { engineRouterRewrite } from "./app/site-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();
  // Nuriel Websites: מיפוי הכתובות רק באתר עסק (בכל אתר אחר — undefined, בדיוק כמו קודם)
  const rewrite = engineRouterRewrite();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ...(rewrite ? { rewrite } : {}),
  });

  return router;
};
