import {
  createRootRoute,
  createHashHistory,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  redirect,
} from "@tanstack/react-router";
import Home from "./home";

const rootRoute = createRootRoute({
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block underline">
        Back to Home
      </Link>
    </main>
  ),
});

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/contour-map",
    component: lazyRouteComponent(() => import("./contourMap")),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/mask-map",
    component: lazyRouteComponent(() => import("./maskMap")),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/workspace",
    beforeLoad: () => {
      throw redirect({ to: "/contour-map", replace: true });
    },
  }),
]);

export const router = createRouter({
  routeTree,
  history: import.meta.env.VITE_GITHUB_PAGES === "true" ? createHashHistory() : undefined,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
