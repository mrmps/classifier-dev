/** The server derives the workspace and return URL from the authenticated session. */
export async function billingRedirect(
  request:
    | { action: "checkout"; plan: "pro" | "scale" }
    | { action: "portal" }
    | { action: "top-up"; amountCents: number }
    | { action: "setup-payment" },
): Promise<string> {
  const { getBillingLink } = await import("./billing.functions");
  const result = await getBillingLink({ data: request });
  if (typeof result.url !== "string")
    throw new Error("Payment management returned an invalid link.");
  const url = new URL(result.url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Payment management returned an invalid link.");
  return url.href;
}
