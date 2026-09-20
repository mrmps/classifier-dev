import legacy, { type Env } from "../index";
import { AppError, type AppEnv } from "../server/db";
import { accountReadRoutes } from "./account";
import { accountClassification } from "./classification";
import { accountMcp } from "./mcp";

/** Account responses, including failures, must remain readable by browser API clients. */
export async function accountApi(request: Request, env: AppEnv & Env, ctx: ExecutionContext): Promise<Response | null> {
  // Preflights carry no key and must not enter account authentication or GET-only routes.
  if (request.method === "OPTIONS") {
    return new URL(request.url).pathname.startsWith("/v1/account/") ? legacy.fetch(request, env, ctx) : null;
  }
  let response: Response | null;
  try {
    response = await accountReadRoutes(request, env)
      ?? await accountMcp(request, env, ctx)
      ?? await accountClassification(request, env, "API", ctx);
  } catch (error) {
    response = Response.json({ error: error instanceof AppError ? error.message : "Unable to complete this request." }, {
      status: error instanceof AppError ? error.status : 500,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!response) return null;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  const exposed = headers.get("access-control-expose-headers");
  headers.set("access-control-expose-headers", [exposed, "x-request-id", "x-billing-status"].filter(Boolean).join(", "));
  return new Response(response.body, { status: response.status, headers });
}
