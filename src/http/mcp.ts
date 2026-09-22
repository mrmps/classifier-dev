import { handleMcp, productServer } from "../mcp";
import { accountClassification } from "./classification";
import type { Env } from "../index";
import { requireApiAccount } from "../server/account-access";
import { AppError, type AppEnv } from "../server/db";

/** MCP and REST share the same account authorization and metering boundary. */
export async function accountMcp(
  request: Request,
  env: AppEnv & Partial<Env>,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    !["/mcp", "/.well-known/mcp"].includes(path) ||
    !/^Bearer\s+classifier_agent_/i.test(
      request.headers.get("authorization") || "",
    )
  )
    return null;
  await requireApiAccount(request, env);
  return handleMcp(
    request,
    productServer(async (body, original) => {
      try {
        const response = await accountClassification(
          new Request(new URL("/v1/classify", request.url), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: original.headers.get("authorization") || "",
              "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "",
              ...(request.headers.get("idempotency-key") ? { "idempotency-key": request.headers.get("idempotency-key")! } : {}),
            },
            body: JSON.stringify(body),
          }),
          env,
          "MCP",
          ctx,
        );
        if (!response)
          return { status: 401, body: { error: "Missing credential." } };
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        };
      } catch (error) {
        return {
          status: error instanceof AppError ? error.status : 500,
          body: {
            error:
              error instanceof AppError
                ? error.message
                : "Classification failed.",
          },
        };
      }
    }),
  );
}
