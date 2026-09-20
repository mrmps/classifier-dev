import { AppError, neonDatabase, type AppEnv } from "./db";

/** Worker bindings contain a connection secret; application code gets a SQL handle. */
export function appEnvironment<T extends object>(bindings: T): T & AppEnv {
  const source = bindings as T & Partial<AppEnv>;
  let database = source.APP_DB;
  return Object.defineProperty(Object.create(bindings), "APP_DB", {
    get() {
      if (database) return database;
      if (!source.DATABASE_URL)
        throw new AppError(503, "The account database is not configured.");
      database = neonDatabase(source.DATABASE_URL);
      return database;
    },
    enumerable: true,
  });
}
