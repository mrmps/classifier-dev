import { createFileRoute } from "@tanstack/react-router";
import { getSignUpUrl } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";
import { authReturnPath } from "../lib/auth-return-path";
import { authNavigationResponse } from "../server/auth-navigation";

export const Route = createFileRoute("/auth/sign-up")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!workosConfigured(env as unknown as AppEnv))
          return new Response("WorkOS sign-up is not configured.", {
            status: 503,
          });
        const returnPathname = authReturnPath(new URL(request.url).searchParams.get("returnTo"));
        return authNavigationResponse(await getSignUpUrl({ data: { returnPathname } }), returnPathname, request);
      },
    },
  },
});
