import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { STALE_TIME, GC_TIME } from "./lib/queryKeys";

export const getRouter = () => {
  // Fresh client per SSR request so cached data never leaks between users.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.medium,
        gcTime: GC_TIME.default,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
