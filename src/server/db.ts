import { neon, types, type CustomTypesConfig } from "@neondatabase/serverless";
import type { AccountAnalyticsEnv } from "./analytics/contracts";

// Postgres returns int8 (including COUNT/SUM) as text by default. Credits must
// stay exact: reject values outside JavaScript's integer range rather than round.
export function parseCreditInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("Database integer exceeds the safe range.");
  return number;
}

export interface QueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}
export interface AppStatement {
  bind(...values: unknown[]): AppStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface AppDatabase {
  prepare(sql: string): AppStatement;
  batch(statements: AppStatement[]): Promise<QueryResult[]>;
}
export interface PostgresQuery {
  sql: string;
  params: unknown[];
}
export type PostgresExecutor = (
  queries: PostgresQuery[],
  transaction: boolean,
) => Promise<QueryResult[]>;

/** Only parameter notation is adapted; every statement is PostgreSQL SQL. */
function parameters(sql: string, values: unknown[]): PostgresQuery {
  let index = 0;
  const numbered = sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$([A-Za-z_]\w*|)\$[\s\S]*?\$\1\$|\?/g,
    (part) => (part === "?" ? `$${++index}` : part),
  );
  if (index !== values.length)
    throw new Error("SQL parameter count does not match bound values.");
  return { sql: numbered, params: values };
}

export function postgresDatabase(execute: PostgresExecutor): AppDatabase {
  async function perform(queries: PostgresQuery[], transaction: boolean) {
    // Retry only PostgreSQL errors that guarantee the transaction was aborted.
    // Never retry network failures: the commit outcome might be unknown.
    for (let attempt = 0; ; attempt++) {
      try {
        return await execute(queries, transaction);
      } catch (error) {
        const databaseError = error as { code?: string; errno?: string };
        const code = databaseError.errno ?? databaseError.code;
        if (
          !transaction ||
          attempt >= 4 ||
          (code !== "40001" && code !== "40P01")
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 * 2 ** attempt));
      }
    }
  }
  class Statement implements AppStatement {
    constructor(
      readonly sql: string,
      readonly values: unknown[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Statement(this.sql, values);
    }
    async all<T = Record<string, unknown>>() {
      return (
        await perform([parameters(this.sql, this.values)], false)
      )[0] as QueryResult<T>;
    }
    async first<T = Record<string, unknown>>() {
      return (await this.all<T>()).results[0] ?? null;
    }
    run() {
      return this.all();
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    batch: (statements) => {
      const queries = statements.map((statement) => {
        if (!(statement instanceof Statement))
          throw new Error("Cannot mix database instances in a transaction.");
        return parameters(statement.sql, statement.values);
      });
      return queries.length ? perform(queries, true) : Promise.resolve([]);
    },
  };
}

export function neonDatabase(databaseUrl: string): AppDatabase {
  const sql = neon(databaseUrl, { fullResults: true });
  // This adapter exposes safe JS integers. Keep its parsers query-local so
  // Drizzle and other clients retain exact string representations of int8.
  const accountTypes: CustomTypesConfig = {
    getTypeParser: (id, format) =>
      (id === 20 || id === 1700) && format !== "binary"
        ? parseCreditInteger
        : types.getTypeParser(id, format),
  };
  return postgresDatabase(async (queries, transaction) => {
    const pending = queries.map((query) => sql.query(query.sql, query.params, { types: accountTypes }));
    const results = transaction
      ? await sql.transaction(pending, {
          isolationLevel: "Serializable",
          fullResults: true,
        })
      : [await pending[0]];
    return results.map((result) => ({
      results: result.rows,
      meta: { changes: result.rowCount },
    }));
  });
}

export interface AppEnv extends AccountAnalyticsEnv {
  APP_DB: AppDatabase;
  DATABASE_URL?: string;
  API_KEY_ENCRYPTION_KEY?: string;
  BILLING_SIGNING_KEY?: string;
  APP_ACCOUNTS_ENABLED?: string;
  AUTUMN_SECRET_KEY?: string;
  AUTUMN_WEBHOOK_SECRET?: string;
  AUTUMN_PRO_PLAN_ID?: string;
  APP_ORIGIN?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_REDIRECT_URI?: string;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export const now = () => new Date().toISOString();
