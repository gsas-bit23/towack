// Server-only module: imported by app/api route handlers only, never by client components.
import { neon } from "@neondatabase/serverless";
import { SCHEMA } from "./schema";

/**
 * Minimal database interface used by the Agent Exchange services. Production: Neon (Postgres over HTTP, from the
 * Vercel-Neon integration's DATABASE_URL). Tests: PGlite (in-memory Postgres) through the same interface.
 * The database only ever stores profiles, messages and sessions: never keys, never funds.
 */
export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

let prod: Db | undefined;
let schemaReady: Promise<void> | undefined;

export function neonDb(): Db {
  if (prod) return prod;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  prod = { query: async (text, params = []) => (await sql.query(text, params)) as never };
  return prod;
}

/** Create tables once per server instance (idempotent: CREATE ... IF NOT EXISTS). */
export async function ensureSchema(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.query(stmt);
}

let devMem: Promise<Db> | undefined;

/** `next dev` without DATABASE_URL only: an in-memory Postgres (PGlite), wiped on restart. Never in production. */
async function devMemoryDb(): Promise<Db> {
  devMem ??= import("@electric-sql/pglite").then(({ PGlite }) => {
    const pg = new PGlite();
    console.warn("[exchange] DATABASE_URL not set: using an in-memory dev database (data is lost on restart)");
    return { query: async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as never };
  });
  return devMem;
}

/** Production database with the schema guaranteed. */
export async function getDb(): Promise<Db> {
  const db = !process.env.DATABASE_URL && process.env.NODE_ENV === "development" ? await devMemoryDb() : neonDb();
  schemaReady ??= ensureSchema(db).catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  await schemaReady;
  return db;
}
