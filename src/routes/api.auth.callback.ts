import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { clearWorkspaceSelection, workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async (context) => {
        if (!workosConfigured(env as unknown as AppEnv))
          return new Response("WorkOS sign-in is not configured.", {
            status: 503,
          });
        const response = await handleCallbackRoute({
          returnPathname: "/app",
          errorRedirectUrl: "/login?error=auth_failed",
        })(context);
        return clearWorkspaceSelection(response, context.request);
      },
    },
  },
});
