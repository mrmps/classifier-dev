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
        const url = new URL(await getSignInUrl({ data: { returnPathname } }));
        // AuthKit's invitation entry point supplies this token. Preserve the SDK's
        // PKCE/state cookies while forwarding the documented WorkOS parameter.
        const invitationToken = search.get("invitation_token");
        if (invitationToken && invitationToken.length <= 2048)
          url.searchParams.set("invitation_token", invitationToken);
        return authNavigationResponse(url.href, returnPathname, request);
      },
    },
  },
});
