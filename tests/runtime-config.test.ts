import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";

const root = new URL("../", import.meta.url);
const renderer = new URL(".github/render-wrangler.mjs", root);
const example = new URL("wrangler.example.toml", root);

function render(env: Record<string, string | undefined>) {
  const directory = mkdtempSync(join(tmpdir(), "classifier-runtime-config-"));
  try {
    copyFileSync(example, join(directory, "wrangler.example.toml"));
    const result = spawnSync(process.execPath, [renderer.pathname], { cwd: directory, env, encoding: "utf8" });
    const output = join(directory, "wrangler.toml");
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, toml: existsSync(output) ? readFileSync(output, "utf8") : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const values = { CLOUDFLARE_ACCOUNT_ID: "cloudflare-account", STATS_KV_ID: "stats-namespace", REPORT_TO: "reports@example.test" };

test("production rendering uses PostgreSQL secrets and preserves closed account access", () => {
  const databaseUrl = "postgresql://fake:test-secret@example.neon.tech/app";
  const result = render({ ...values, DATABASE_URL: databaseUrl });
  expect(result.status).toBe(0);
  expect(result.toml).not.toContain(databaseUrl);
  expect(result.stdout + result.stderr).not.toContain(databaseUrl);
  const config = Bun.TOML.parse(result.toml!) as any;
  expect(config.main).toBe("src/server.ts");
  expect(config.d1_databases).toBeUndefined();
  expect(config.vars.APP_ACCOUNTS_ENABLED).toBe("true");
  expect(config.vars.DATABASE_URL).toBeUndefined();
  expect(config.secrets.required).toContain("DATABASE_URL");
  expect(config.secrets.required).not.toContain("DATABASE_URL_UNPOOLED");
  expect(config.placement).toEqual({ region: "aws:us-west-2" });
  const schema = JSON.parse(readFileSync(new URL("node_modules/wrangler/config-schema.json", root), "utf8"));
  const validate = new Ajv({ strict: false }).compile(schema.definitions.RawConfig.properties.placement);
  expect(validate(config.placement)).toBe(true);
});

test("renderer needs no D1 identifier but still refuses missing Cloudflare bindings", () => {
  expect(render(values).status).toBe(0);
  const missing = render({ ...values, STATS_KV_ID: undefined });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("STATS_KV_ID");
  expect(missing.toml).toBeNull();
});

test("local dev uses the same SQL runtime without a fake D1 database", () => {
  const config = Bun.TOML.parse(readFileSync(new URL("wrangler.local.toml", root), "utf8")) as any;
  expect(config.main).toBe("src/server.ts");
  expect(config.d1_databases).toBeUndefined();
  expect(config.vars.APP_DEMO).toBe("true");
  expect(config.vars.APP_ACCOUNTS_ENABLED).toBe("false");
  expect(config.vars.DATABASE_URL).toBeUndefined();
});

test("deployment migrates directly and gives the Worker only the pooled URL", () => {
  const workflow = readFileSync(new URL(".github/workflows/deploy.yml", root), "utf8");
  expect(workflow).toContain("DATABASE_URL_UNPOOLED: ${{ secrets.DATABASE_URL_UNPOOLED }}");
  expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL_UNPOOLED }}\n        run: npm run db:migrate");
  expect(workflow).toContain("JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL })");
  expect(workflow).not.toContain("JSON.stringify({ DATABASE_URL_UNPOOLED:");
});
