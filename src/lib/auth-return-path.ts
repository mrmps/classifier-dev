/** Auth flows may return only to this application's protected workspace. */
export function authReturnPath(requested: unknown): string {
  if (typeof requested !== "string" || requested.length > 1024 || !requested.startsWith("/") || requested.includes("\\"))
    return "/app";
  try {
    const url = new URL(requested, "https://classifier.invalid");
    if (url.origin !== "https://classifier.invalid" ||
        (url.pathname !== "/app" && !url.pathname.startsWith("/app/")))
      return "/app";
    // AuthKit's callback treats fragments as pathname text; workspace screens
    // don't use anchors, so never carry one into the authorization state.
    return url.pathname + url.search;
  } catch {
    return "/app";
  }
}
