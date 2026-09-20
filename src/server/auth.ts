import { FREE_ALLOWANCE_CREDITS } from "../lib/billing";
import { AppError, hashToken, now, randomToken, type AppEnv } from "./db";
import { WORKSPACE_COOKIE } from "./organizations";

/** A selected workspace belongs to the previous session, not the next signer. */
export function clearWorkspaceSelection(
  response: Response,
  request: Request,
): Response {
  response.headers.append(
    "Set-Cookie",
    `${WORKSPACE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  );
  return response;
}

/** Record the grant separately from the balance so an exhausted wallet stays exhausted. */
export async function provisionHostedAccount(
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  env: AppEnv,
): Promise<string> {
  const id = `workos:${user.id}`;
  const timestamp = now();
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      "INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES(?,?,?,0,?,?,?) ON CONFLICT DO NOTHING",
    ).bind(
      id,
      user.email,
      [user.firstName, user.lastName].filter(Boolean).join(" ") || "Your workspace",
      timestamp,
      timestamp,
      timestamp,
    ),
    ...(env.APP_ACCOUNTS_ENABLED === "true"
      ? [env.APP_DB.prepare(
          "UPDATE app_accounts SET balance=balance+?,signup_granted_at=? WHERE id=? AND signup_granted_at IS NULL",
        ).bind(FREE_ALLOWANCE_CREDITS, timestamp, id)]
      : []),
  ]);
  return id;
}
export function isLocalDemo(request: Request, env: AppEnv): boolean {
  const host = new URL(request.url).hostname;
  const forwarded = request.headers.get("X-Forwarded-For");
  return (
    env.APP_DEMO === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    !request.headers.has("CF-Ray") &&
    (!forwarded ||
      forwarded
        .split(",")
        .every((ip) => ["127.0.0.1", "::1"].includes(ip.trim())))
  );
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin)
    throw new AppError(403, "Request origin does not match.");
}
export async function demoLogin(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (!isLocalDemo(request, env))
    throw new AppError(503, "Account sign-in is not configured.");
  assertSameOrigin(request);
  const timestamp = now();
  const reset = new Date(Date.now() + 30 * 86400000).toISOString();
  await env.APP_DB.prepare(
    "INSERT INTO app_accounts(id,email,name,reset_at,created_at,period_start,balance) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  )
    .bind(
      "local-demo",
      "you@localhost",
      "Your workspace",
      reset,
      timestamp,
      timestamp,
      FREE_ALLOWANCE_CREDITS,
    )
    .run();
  const token = randomToken();
  await env.APP_DB.prepare(
    "INSERT INTO app_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)",
  )
    .bind(
      await hashToken(token),
      "local-demo",
      new Date(Date.now() + 86400000).toISOString(),
    )
    .run();
  return clearWorkspaceSelection(
    Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `classifier_app=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
          "Cache-Control": "no-store",
        },
      },
    ),
    request,
  );
}
export async function requireAccount(
  request: Request,
  env: AppEnv,
): Promise<string> {
  // Local sessions never authorize a deployed account, even if a database was copied.
  if (!isLocalDemo(request, env)) {
    if (!workosConfigured(env))
      throw new AppError(
        503,
        "WorkOS sign-in is not configured for this deployment.",
      );
    const { getAuth } = await import("@workos/authkit-tanstack-react-start");
    const { user } = await getAuth();
    if (!user) throw new AppError(401, "Sign in to continue.");
    return provisionHostedAccount(user, env);
  }
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)classifier_app=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) throw new AppError(401, "Sign in to continue.");
  const session = await env.APP_DB.prepare(
    "SELECT account_id FROM app_sessions WHERE token_hash=? AND expires_at>?",
  )
    .bind(await hashToken(token), now())
    .first<{ account_id: string }>();
  if (!session)
    throw new AppError(401, "Your session expired. Please sign in again.");
  return session.account_id;
}
export async function logout(request: Request, env: AppEnv): Promise<Response> {
  assertSameOrigin(request);
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)classifier_app=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (token)
    await env.APP_DB.prepare("DELETE FROM app_sessions WHERE token_hash=?")
      .bind(await hashToken(token))
      .run();
  return clearWorkspaceSelection(
    Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie":
            "classifier_app=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        },
      },
    ),
    request,
  );
}

export function workosConfigured(env: AppEnv): boolean {
  return !!(
    env.WORKOS_API_KEY &&
    env.WORKOS_CLIENT_ID &&
    env.WORKOS_REDIRECT_URI &&
    env.WORKOS_COOKIE_PASSWORD &&
    env.WORKOS_COOKIE_PASSWORD.length >= 32
  );
}
