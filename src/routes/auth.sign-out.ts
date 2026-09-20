import { createFileRoute } from "@tanstack/react-router";
import { signOut } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { assertSameOrigin, workosConfigured } from "../server/auth";
import type { AppEnv } from "../server/db";
import { appEnvironment } from "../server/environment";
export const Route = createFileRoute("/auth/sign-out")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        assertSameOrigin(request);
        const bindings = appEnvironment(env);
        if (!workosConfigured(bindings))
          return new Response("Sign-in is not configured.", { status: 503 });
        await signOut({ data: { returnTo: "/" } });
        return new Response(null, { status: 303, headers: { Location: "/" } });
      },
    },
  },
});
