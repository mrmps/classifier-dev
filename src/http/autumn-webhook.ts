import { Webhook } from "svix";
import { type AutumnEnv } from "../server/autumn";
import { reconcileAutumnCustomer } from "../server/billing-sync";

export async function autumnWebhook(request: Request, env: AutumnEnv): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!env.AUTUMN_WEBHOOK_SECRET || !env.AUTUMN_SECRET_KEY) return new Response("Billing is not configured.", { status: 503 });
  const id = request.headers.get("svix-id");
  if (!id || id.length > 256) return new Response("Invalid signature.", { status: 400 });
  let payload: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128_000) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder().decode(bytes);
    new Webhook(env.AUTUMN_WEBHOOK_SECRET).verify(raw, {
      "svix-id": id, "svix-timestamp": request.headers.get("svix-timestamp") || "", "svix-signature": request.headers.get("svix-signature") || "",
    });
    payload = JSON.parse(raw);
  } catch { return new Response("Invalid signature.", { status: 400 }); }
  const event = payload as { type?: unknown; data?: { customer_id?: unknown; entity_id?: unknown } } | null;
  if (!event || typeof event !== "object") return new Response(null, { status: 400 });
  if (event.type !== "billing.updated") return new Response(null, { status: 204 });
  const customerId = event.data?.customer_id;
  if (typeof customerId !== "string" || !customerId || customerId.length > 256 || event.data?.entity_id != null) return new Response(null, { status: 400 });
  try {
    await env.APP_DB.prepare("INSERT INTO app_autumn_events(id,customer_id,received_at) VALUES(?,?,?) ON CONFLICT DO NOTHING")
      .bind(id, customerId, new Date().toISOString()).run();
    const stored = await env.APP_DB.prepare("SELECT customer_id,processed_at FROM app_autumn_events WHERE id=?").bind(id).first<{ customer_id: string; processed_at: string | null }>();
    if (!stored || stored.customer_id !== customerId) return new Response(null, { status: 409 });
    if (stored.processed_at) return new Response(null, { status: 204 });
    await reconcileAutumnCustomer(env, customerId);
    await env.APP_DB.prepare("UPDATE app_autumn_events SET processed_at=? WHERE id=?").bind(new Date().toISOString(), id).run();
    return new Response(null, { status: 204 });
  } catch { return new Response("Billing synchronization failed.", { status: 503 }); }
}
