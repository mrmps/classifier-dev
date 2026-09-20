/** Auth flows may return only to this application's protected workspace. */
export function authReturnPath(requested: unknown): string {
  if (typeof requested !== "string" || requested.length > 1024 || !requested.startsWith("/") || requested.includes("\\"))
    return "/app";
  try {
    const url = new URL(requested, "https://classifier.invalid");
    if (url.origin !== "https://classifier.invalid" ||
        (url.pathname !== "/app" && !url.pathname.startsWith("/app/")))
      return "/app";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/app";
  }
}
