import { AppError, hashToken, now, randomToken, type AppEnv } from "./db";

async function encryptionKey(env: AppEnv) {
  const secret = env.API_KEY_ENCRYPTION_KEY || env.WORKOS_COOKIE_PASSWORD;
  if (!secret || secret.length < 32)
    throw new AppError(503, "API key storage is not configured.");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
const hex = (data: Uint8Array) =>
  Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
async function encrypt(value: string, context: string, env: AppEnv) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return `${hex(iv)}:${hex(new Uint8Array(ciphertext))}`;
}
async function decrypt(value: string, context: string, env: AppEnv) {
  const [iv, ciphertext] = value
    .split(":")
    .map((part) =>
      Uint8Array.from(part.match(/../g)!, (byte) => parseInt(byte, 16)),
    );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(context),
      },
      await encryptionKey(env),
      ciphertext,
    ),
  );
}
async function material(workspace: string, id: string, env: AppEnv) {
  const secret = `classifier_agent_${randomToken()}`;
  return {
    secret,
    digest: await hashToken(secret),
    prefix: secret.slice(0, 28),
    encrypted: await encrypt(secret, JSON.stringify([workspace, id]), env),
  };
}
export async function createApiKey(
  workspace: string,
  name: string,
  env: AppEnv,
  client = "API",
) {
  const agentId = crypto.randomUUID();
  const key = await material(workspace, agentId, env);
  await env.APP_DB.prepare(
    "INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at,encrypted_secret) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      agentId,
      workspace,
      name,
      client,
      key.digest,
      key.prefix,
      now(),
      key.encrypted,
    )
    .run();
  return { secret: key.secret, agentId };
}
/** Provision once, including across parallel loads. Revocation never recreates access. */
export async function ensureDefaultKey(workspace: string, env: AppEnv) {
  const account = await env.APP_DB.prepare(
    "SELECT default_key_provisioned FROM app_accounts WHERE id=?",
  )
    .bind(workspace)
    .first<{ default_key_provisioned: boolean }>();
  if (!account || account.default_key_provisioned) return;
  const agentId = crypto.randomUUID();
  const key = await material(workspace, agentId, env);
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      "SELECT id FROM app_accounts WHERE id=? FOR UPDATE",
    ).bind(workspace),
    env.APP_DB.prepare(
      "INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at,encrypted_secret) SELECT ?,?,'Default','API',?,?,?,? WHERE EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND NOT default_key_provisioned)",
    ).bind(
      agentId,
      workspace,
      key.digest,
      key.prefix,
      now(),
      key.encrypted,
      workspace,
    ),
    env.APP_DB.prepare(
      "UPDATE app_accounts SET default_key_provisioned=TRUE WHERE id=?",
    ).bind(workspace),
  ]);
}
export async function revealApiKey(workspace: string, id: string, env: AppEnv) {
  const row = await env.APP_DB.prepare(
    "SELECT encrypted_secret FROM app_agents WHERE account_id=? AND id=? AND status!='revoked'",
  )
    .bind(workspace, id)
    .first<{ encrypted_secret: string | null }>();
  if (!row) throw new AppError(404, "Active API key not found.");
  if (!row.encrypted_secret)
    throw new AppError(
      409,
      "This older key cannot be revealed. Rotate it to create a recoverable key.",
    );
  return {
    secret: await decrypt(
      row.encrypted_secret,
      JSON.stringify([workspace, id]),
      env,
    ),
    agentId: id,
  };
}
export async function rotateApiKey(
  workspace: string,
  id: string,
  prefix: string,
  env: AppEnv,
) {
  const key = await material(workspace, id, env);
  const result = await env.APP_DB.prepare(
    "UPDATE app_agents SET token_hash=?,prefix=?,encrypted_secret=? WHERE account_id=? AND id=? AND prefix=? AND status!='revoked'",
  )
    .bind(key.digest, key.prefix, key.encrypted, workspace, id, prefix)
    .run();
  if (!result.meta.changes)
    throw new AppError(
      409,
      "This key changed or was revoked. Refresh before trying again.",
    );
  return { secret: key.secret, agentId: id };
}
