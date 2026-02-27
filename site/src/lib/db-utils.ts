/**
 * D1 database utility helpers.
 */

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

/** Execute a list of D1 prepared statements in chunks of 100 (D1 batch limit). */
export async function safeBatch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
}
