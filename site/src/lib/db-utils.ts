/**
 * D1 database utility helpers.
 */

/**
 * Read-only D1 session — routes queries to the nearest replica.
 * Falls back to raw db if withSession is not available (older compat dates).
 */
export function readDb(db: D1Database): D1Database {
  try {
    return (db as any).withSession('first-unconstrained') as D1Database;
  } catch { return db; }
}

/**
 * Write D1 session — ensures read-after-write consistency within the invocation.
 * Falls back to raw db if withSession is not available (older compat dates).
 */
export function writeDb(db: D1Database): D1Database {
  try {
    return (db as any).withSession('first-primary') as D1Database;
  } catch { return db; }
}

/** SQL fragment for the SETL (Structural-Editorial Tension Level) formula. Pass the table alias. */
export const SETL_CASE_SQL = (alias: string): string =>
  `CASE WHEN ${alias}.editorial >= ${alias}.structural` +
  ` THEN  SQRT(ABS(${alias}.editorial - ${alias}.structural) * MAX(ABS(${alias}.editorial), ABS(${alias}.structural)))` +
  ` ELSE -SQRT(ABS(${alias}.editorial - ${alias}.structural) * MAX(ABS(${alias}.editorial), ABS(${alias}.structural)))` +
  ` END`;

/**
 * KV-backed query cache. Tries KV first; on miss, calls queryFn and stores result.
 * Keys are stored as `q:<key>`. Errors are non-fatal — falls through to queryFn.
 */
export async function cachedQuery<T>(
  kv: KVNamespace,
  key: string,
  queryFn: () => Promise<T>,
  ttlSeconds = 300
): Promise<T> {
  try {
    const cached = await kv.get(`q:${key}`, 'json');
    if (cached !== null) return cached as T;
  } catch { /* KV miss or error — fall through to query */ }
  const result = await queryFn();
  try {
    await kv.put(`q:${key}`, JSON.stringify(result), { expirationTtl: ttlSeconds });
  } catch { /* non-fatal */ }
  return result;
}

/** D1 batch statement limit — maximum statements per db.batch() call. */
export const D1_BATCH_SIZE = 100;

/** Execute a list of D1 prepared statements in chunks of D1_BATCH_SIZE. */
export async function safeBatch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
  }
}
