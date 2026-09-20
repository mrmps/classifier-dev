/** Both billing entry points must use the original email identity. Changing this
 * derivation would strand existing subscriptions and permit duplicate purchases. */
export async function billingCustomerId(email: string, signingKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, "0")).join("");
}
