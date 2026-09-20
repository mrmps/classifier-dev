import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
// Cloudflare nodejs_compat populates process.env from configured Worker bindings.
// Keep local demo available without initializing an unconfigured AuthKit client.
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
    ...(process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    (process.env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
    process.env.WORKOS_REDIRECT_URI
      ? [authkitMiddleware()]
      : []),
  ],
}));
