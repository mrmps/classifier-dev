import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";
export const Route = createFileRoute("/auth/sign-in")({
  server: {
    handlers: {
      GET: async () => {
        if (!workosConfigured(env as unknown as AppEnv))
          return new Response("WorkOS sign-in is not configured.", {
            status: 503,
          });
        return new Response(null, {
          status: 302,
          headers: {
            Location: await getSignInUrl({ data: { returnPathname: "/app" } }),
          },
        });
      },
    },
  },
});
