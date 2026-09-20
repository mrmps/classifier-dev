import { createFileRoute, isRedirect } from "@tanstack/react-router";
import { signOut } from "@workos/authkit-tanstack-react-start";
import { env } from "cloudflare:workers";
import { assertSameOrigin, clearWorkspaceSelection, workosConfigured } from "../server/auth";
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
        try {
          await signOut({ data: { returnTo: new URL("/", request.url).href } });
        } catch (error) {
          if (!isRedirect(error)) throw error;
          // AuthKit supplies the logout URL and session deletion cookies.
          // A form POST must become a GET when navigating to WorkOS.
          const headers = new Headers(error.headers);
          headers.set("Location", headers.get("Location") || "/");
          return clearWorkspaceSelection(new Response(null, { status: 303, headers }), request);
        }
        return clearWorkspaceSelection(new Response(null, { status: 303, headers: { Location: "/" } }), request);
      },
    },
  },
});
