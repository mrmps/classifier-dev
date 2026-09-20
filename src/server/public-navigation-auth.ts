import type { AppEnv } from "./db";
import { workosConfigured } from "./auth";
import { hasClassifyQuery } from "../query";

type AuthResult = {
  auth: { user: unknown | null };
  refreshedSessionData?: string;
  saveSession?: (session: string) => Promise<string[]>;
};

type Authenticate = (request: Request) => Promise<AuthResult>;

const SHELL_CLIENT =
  /curl|wget|httpie|python|node|undici|axios|go-http|java|okhttp|bun\/|deno|mcp\/|classify-cli/i;
const PUBLIC_DOCUMENT_PATHS = new Set([
  "developers",
  "docs",
  "mcp-setup",
  "pricing",
  "about",
  "contact",
  "privacy",
  "terms",
  "skills",
]);

/** Match every content-negotiation path that can select a rendered public page. */
export function mayRenderPublicHtml(request: Request): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return false;
  }
  if (path.endsWith(".md")) return false;
  const format = url.searchParams.get("format");
  const accept = request.headers.get("Accept") ?? "";
  if (
    format === "text" ||
    format === "markdown" ||
    /\btext\/markdown\b/.test(accept)
  )
    return false;
  const explicitlyHtml =
    format === "html" || /\btext\/html\b/.test(accept);
  if (["", "index.html", "chat", "benchmark"].includes(path)) {
    return !hasClassifyQuery(url) && explicitlyHtml;
  }
  const isDocument =
    PUBLIC_DOCUMENT_PATHS.has(path) ||
    /^skills\/[a-z0-9-]{1,64}$/.test(path);
  return (
    isDocument &&
    (explicitlyHtml ||
      !SHELL_CLIENT.test(request.headers.get("User-Agent") ?? ""))
  );
}

async function authenticate(request: Request): Promise<AuthResult> {
  const { getAuthkit } = await import(
    "@workos/authkit-tanstack-react-start"
  );
  const authkit = await getAuthkit();
  const result = await authkit.withAuth(request);
  return {
    ...result,
    saveSession: async (session) => {
      const saved = await authkit.saveSession(undefined, session);
      if (saved.response) return saved.response.headers.getSetCookie();
      const cookie = saved.headers?.["Set-Cookie"];
      return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
    },
  };
}

/** Validate the app session before personalizing the shared public navigation. */
export async function publicNavigationAuth(
  request: Request,
  env: AppEnv,
  resolve: Authenticate = authenticate,
): Promise<{ signedIn: boolean; setCookies: string[] }> {
  if (!workosConfigured(env)) return { signedIn: false, setCookies: [] };

  const result = await resolve(request);
  const setCookies =
    result.refreshedSessionData && result.saveSession
      ? await result.saveSession(result.refreshedSessionData)
      : [];
  return { signedIn: result.auth.user !== null, setCookies };
}
