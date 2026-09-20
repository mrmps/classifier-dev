import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import legacy, { type Env } from "./index";
import { AppError, type AppEnv } from "./server/db";
import { accountMcp } from "./http/mcp";
import { accountClassification } from "./http/classification";
import { isAppRequest } from "./http/dispatch";
import { appEnvironment } from "./server/environment";
import { accountReadRoutes } from "./http/account";
import { autumnWebhook } from "./http/autumn-webhook";
import { syncAutumnAccounts } from "./server/billing-sync";
import {
  mayRenderPublicHtml,
  publicNavigationAuth,
} from "./server/public-navigation-auth";
export { RateLimiter, BillingAccount } from "./index";

const start = createStartHandler(defaultStreamHandler);
export default {
  async fetch(
    request: Request,
    bindings: Env & Partial<AppEnv>,
    ctx: ExecutionContext,
  ) {
    const env = appEnvironment(bindings);
    try {
      const path = new URL(request.url).pathname;
      if (path === "/webhooks/autumn") return await autumnWebhook(request, env);
      const accountRead = await accountReadRoutes(request, env);
      if (accountRead) return accountRead;
      const mcp = await accountMcp(request, env, ctx);
      if (mcp) return mcp;
      const classification = await accountClassification(
        request,
        env,
        "API",
        ctx,
      );
      if (classification) return classification;
      if (isAppRequest(request)) {
        const response = await start(request);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof AppError
              ? error.message
              : "Unable to complete this request.",
        },
        {
          status: error instanceof AppError ? error.status : 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    const auth = mayRenderPublicHtml(request)
      ? await publicNavigationAuth(request, env)
      : { signedIn: false, setCookies: [] };
    const response = await legacy.fetch(request, env, ctx, {
      viewer: { signedIn: auth.signedIn },
    });
    if (!auth.signedIn && auth.setCookies.length === 0) return response;

    const headers = new Headers(response.headers);
    if (
      auth.signedIn &&
      response.headers.get("Content-Type")?.startsWith("text/html")
    ) {
      headers.set("Cache-Control", "private, no-store");
    }
    for (const cookie of auth.setCookies) headers.append("Set-Cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
  async scheduled(
    controller: ScheduledController,
    bindings: Env & Partial<AppEnv>,
    ctx: ExecutionContext,
  ) {
    const env = appEnvironment(bindings);
    if (env.APP_ACCOUNTS_ENABLED === "true")
      ctx.waitUntil(syncAutumnAccounts(env));
    return legacy.scheduled(controller, env, ctx);
  },
};
