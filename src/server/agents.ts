import { createApiKey, revealApiKey, rotateApiKey } from "./api-keys";
import { isDemoWorkspace } from "./organizations";
import { performBillingAction } from "./billing";
import { isBillingPlanId } from "../lib/billing";
import type { AppAction, ActionResult } from "./contracts";
import { AppError, type AppEnv } from "./db";
import { getSnapshot } from "./accounts";
export async function performAction(
  accountId: string,
  action: AppAction,
  env: AppEnv,
): Promise<ActionResult> {
  action = validateAppAction(action);
  if (
    !(await isDemoWorkspace(accountId, env)) &&
    env.APP_ACCOUNTS_ENABLED !== "true"
  )
    throw new AppError(503, "Account management is not enabled yet.");
  let secret: string | undefined, agentId: string | undefined;
  if (action.type === "billing-subscribe") {
    await performBillingAction(accountId, action, env);
  } else if (action.type === "enroll" || action.type === "create-key") {
    const client = action.type === "enroll" ? action.client : "API";
    const name = (action.name || client).trim();
    if (!name || name.length > 80 || !client || client.length > 40)
      throw new AppError(400, "Choose a name of 1–80 characters.");
    ({ secret, agentId } = await createApiKey(accountId, name, env, client));
  } else if (action.type === "reveal-key") {
    ({ secret, agentId } = await revealApiKey(accountId, action.keyId, env));
  } else if (action.type === "rotate-key") {
    ({ secret, agentId } = await rotateApiKey(
      accountId,
      action.keyId,
      action.prefix,
      env,
    ));
  } else if (action.type === "rename-key") {
    const result = await env.APP_DB.prepare(
      "UPDATE app_agents SET name=? WHERE id=? AND account_id=? AND status!='revoked'",
    )
      .bind(action.name.trim(), action.keyId, accountId)
      .run();
    if (!result.meta.changes)
      throw new AppError(404, "Active API key not found.");
  } else if (
    ["pause", "resume", "revoke", "revoke-key"].includes(action.type)
  ) {
    const id =
      action.type === "revoke-key"
        ? action.keyId
        : "agentId" in action
          ? action.agentId
          : "";
    const status =
      action.type === "pause"
        ? "paused"
        : action.type === "resume"
          ? "pending"
          : "revoked";
    const result = await env.APP_DB.prepare(
      "UPDATE app_agents SET status=CASE WHEN ?='pending' AND last_used IS NOT NULL THEN 'connected' ELSE ? END WHERE id=? AND account_id=? AND status!='revoked'",
    )
      .bind(status, status, id, accountId)
      .run();
    if (!result.meta.changes)
      throw new AppError(404, "Active agent not found.");
  } else if (action.type === "intent") {
    if (!["agent", "api"].includes(action.intent))
      throw new AppError(400, "Invalid intent.");
    await env.APP_DB.prepare("UPDATE app_accounts SET intent=? WHERE id=?")
      .bind(action.intent, accountId)
      .run();
  } else if (action.type === "set-name") {
    const name = action.name.trim();
    if (!name || name.length > 80)
      throw new AppError(400, "Name must contain 1–80 characters.");
    await env.APP_DB.prepare("UPDATE app_accounts SET name=? WHERE id=?")
      .bind(name, accountId)
      .run();
  } else if (action.type !== "refresh")
    throw new AppError(400, "Unknown account action.");
  return {
    snapshot: await getSnapshot(accountId, env),
    ...(secret ? { secret, agentId } : {}),
  };
}

/** Validate untrusted RPC payloads before any database operation. */
export function validateAppAction(value: unknown): AppAction {
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new AppError(400, "Invalid account action.");
  }
  const action = value as Record<string, unknown>;
  const text = (field: string, max = 80) =>
    typeof action[field] === "string" &&
    (action[field] as string).length > 0 &&
    (action[field] as string).length <= max;
  switch (action.type) {
    case "billing-top-up":
    case "billing-auto-top-up":
      throw new AppError(
        403,
        "Only subscriptions are available. Top-ups and automatic purchases are disabled.",
      );
    case "billing-subscribe":
      if (!text("idempotencyKey", 120) || !isBillingPlanId(action.plan))
        throw new AppError(400, "Invalid plan.");
      break;
    case "refresh":
      break;
    case "enroll":
      if (!text("client", 40) || (action.name !== undefined && !text("name")))
        throw new AppError(400, "Invalid agent name or client.");
      break;
    case "create-key":
    case "set-name":
      if (!text("name"))
        throw new AppError(400, "Name must contain 1–80 characters.");
      break;
    case "rename-key":
      if (!text("name") || !(action.name as string).trim())
        throw new AppError(400, "Choose a key name.");
      if (!text("keyId")) throw new AppError(400, "Invalid key.");
      break;
    case "rotate-key":
      if (!text("prefix")) throw new AppError(400, "Invalid key prefix.");
      if (!text("keyId")) throw new AppError(400, "Invalid key.");
      break;
    case "reveal-key":
    case "revoke-key":
      if (!text("keyId")) throw new AppError(400, "Invalid key.");
      break;
    case "pause":
    case "resume":
    case "revoke":
      if (!text("agentId")) throw new AppError(400, "Invalid agent.");
      break;
    case "intent":
      if (action.intent !== "agent" && action.intent !== "api")
        throw new AppError(400, "Invalid intent.");
      break;
    default:
      throw new AppError(400, "Unknown account action.");
  }
  return action as unknown as AppAction;
}
