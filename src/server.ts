import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import worker, { type Env } from "./index";
import { AppError, type AppEnv } from "./server/db";
import { accountApi } from "./http/account-api";
import { isAppRequest } from "./http/dispatch";
import { appEnvironment } from "./server/environment";
import { autumnWebhook } from "./http/autumn-webhook";
import { syncAutumnAccounts } from "./server/billing-sync";
export { RateLimiter } from "./index";

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
      const account = await accountApi(request, env, ctx);
      if (account) return account;
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
    return worker.fetch(request, env, ctx);
  },
  async scheduled(
    controller: ScheduledController,
    bindings: Env & Partial<AppEnv>,
    ctx: ExecutionContext,
  ) {
    const env = appEnvironment(bindings);
    if (env.APP_ACCOUNTS_ENABLED === "true")
      ctx.waitUntil(syncAutumnAccounts(env));
    return worker.scheduled(controller, env, ctx);
  },
};
