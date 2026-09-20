import { authReturnPath } from "../lib/auth-return-path";

// This cookie remembers navigation only, never authenticates a user. Bind it
// to the individual OAuth flow so simultaneous login tabs cannot overwrite it.
async function returnCookieName(url: URL) {
  const state = url.searchParams.get("state");
  if (!state) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  const suffix = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `classifier_auth_return_${suffix}`;
}

function cookie(name: string, value: string, request: Request, maxAge: number) {
  return `${name}=${value}; Path=/api/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

export async function authNavigationResponse(url: string, returnTo: string, request: Request) {
  const headers = new Headers({ Location: url });
  const name = await returnCookieName(new URL(url));
  // Outlive the ten-minute PKCE cookie so an expired sign-in can still retry
  // its destination. This navigation hint contains no credentials.
  if (name) headers.append("Set-Cookie", cookie(name, encodeURIComponent(authReturnPath(returnTo)), request, 3600));
  return new Response(null, { status: 302, headers });
}

export async function callbackNavigation(request: Request) {
  const name = await returnCookieName(new URL(request.url));
  let returnTo = "/app";
  if (name) {
    const value = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    try { returnTo = authReturnPath(value ? decodeURIComponent(value) : undefined); } catch { /* malformed cookies use the dashboard */ }
  }
  return {
    errorRedirectUrl: `/login?error=auth_failed&returnTo=${encodeURIComponent(returnTo)}`,
    clearCookie: name ? cookie(name, "", request, 0) : null,
  };
}
