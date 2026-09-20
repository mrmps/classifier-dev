import { FREE_ALLOWANCE_CREDITS } from "../lib/billing";
import { AppError, now, type AppEnv } from "./db";
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
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        "Your workspace",
      timestamp,
      timestamp,
      timestamp,
    ),
    ...(env.APP_ACCOUNTS_ENABLED === "true"
      ? [
          env.APP_DB.prepare(
            "UPDATE app_accounts SET balance=balance+?,signup_granted_at=? WHERE id=? AND signup_granted_at IS NULL",
          ).bind(FREE_ALLOWANCE_CREDITS, timestamp, id),
        ]
      : []),
  ]);
  return id;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin)
    throw new AppError(403, "Request origin does not match.");
}
export async function requireAccount(
  request: Request,
  env: AppEnv,
): Promise<string> {
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

export function workosConfigured(env: AppEnv): boolean {
  return !!(
    env.WORKOS_API_KEY &&
    env.WORKOS_CLIENT_ID &&
    env.WORKOS_REDIRECT_URI &&
    env.WORKOS_COOKIE_PASSWORD &&
    env.WORKOS_COOKIE_PASSWORD.length >= 32
  );
}
