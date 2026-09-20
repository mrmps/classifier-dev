import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { clearWorkspaceSelection, workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";
import { callbackNavigation } from "../server/auth-navigation";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async (context) => {
        if (!workosConfigured(env as unknown as AppEnv))
          return new Response("WorkOS sign-in is not configured.", {
            status: 503,
          });
        const navigation = await callbackNavigation(context.request);
        const response = await handleCallbackRoute({ errorRedirectUrl: navigation.errorRedirectUrl })(context);
        if (navigation.clearCookie) response.headers.append("Set-Cookie", navigation.clearCookie);
        return clearWorkspaceSelection(response, context.request);
      },
    },
  },
});
