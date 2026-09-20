/** Claim application paths before the legacy GET /{labels}/{text} fallback. */
export function isAppRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return ["/app", "/login", "/auth", "/_server"].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
