/**
 * D1 database utility helpers.
 */

/** Execute a list of D1 prepared statements in chunks of 100 (D1 batch limit). */
export async function safeBatch(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  if (stmts.length === 0) return;
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
}
