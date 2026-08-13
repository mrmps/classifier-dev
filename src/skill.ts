import SKILL_MD from "./SKILL.md";

export { SKILL_MD };

export const SKILL_NAME = "bulk-classify";

export const SKILL_DESCRIPTION =
  "Sort many texts into your own categories without reading them, using a keyless HTTP API. Use when triaging, filtering, routing or bucketing more items than are worth putting in context.";

const DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

/**
 * The discovery index has to carry a sha256 of the artifact, and an index that
 * disagrees with the file makes the skill uninstallable. Rather than commit a
 * digest that a later edit to SKILL.md would silently invalidate, hash the
 * bytes we actually serve, once per isolate.
 */
let cached: string | null = null;

async function skillDigest(): Promise<string> {
  if (cached) return cached;
  const bytes = new TextEncoder().encode(SKILL_MD);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  cached = `sha256:${[...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  return cached;
}

/** RFC 8615 discovery document, so `npx skills add https://classifier.dev` works. */
export async function skillIndex(origin: string) {
  return {
    $schema: DISCOVERY_SCHEMA,
    skills: [
      {
        name: SKILL_NAME,
        type: "skill-md" as const,
        description: SKILL_DESCRIPTION,
        url: `${origin}/skill.md`,
        digest: await skillDigest(),
      },
    ],
  };
}
