import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: (context) => context.handlerType === "serverFn",
    }),
    // nodejs_compat exposes Worker bindings here. This module also participates
    // in the client build, so it must not import cloudflare:workers directly.
    ...(process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_REDIRECT_URI && (process.env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32
      ? [authkitMiddleware()] : []),
  ],
}));
