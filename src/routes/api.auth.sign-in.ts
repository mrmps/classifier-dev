import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";
import { authReturnPath } from "../lib/auth-return-path";
import { authNavigationResponse } from "../server/auth-navigation";

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!workosConfigured(env as unknown as AppEnv))
          return new Response("WorkOS sign-in is not configured.", {
            status: 503,
          });
        const search = new URL(request.url).searchParams;
        const returnPathname = authReturnPath(search.get("returnTo") ?? search.get("returnPathname"));
        return authNavigationResponse(await getSignInUrl({ data: { returnPathname } }), returnPathname, request);
      },
    },
  },
});
