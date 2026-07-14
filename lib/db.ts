import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export type DbExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function isDbStateReadEnabled() {
  const store = process.env.MEETING_STATE_STORE?.toLowerCase();
  const requested = store === "db" || store === "postgres" || process.env.MEETING_USE_DB_STATE === "true";
  return requested && Boolean(getDatabaseUrl());
}

export function getDbPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required when DB state read is enabled.");
  }
  if (!pool) {
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
  return getDbPool().query<T>(text, values);
}

export async function withDbTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
