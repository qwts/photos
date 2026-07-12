import type BetterSqlite3 from 'better-sqlite3-multiple-ciphers';

// better-sqlite3's statement results are typed `any`; these helpers are the
// single place that boundary is crossed (caller declares the row shape), so
// the `any` never leaks into repository or test code.

export function queryAll<T>(db: BetterSqlite3.Database, sql: string, params?: Record<string, unknown>): T[] {
  const statement = db.prepare(sql);
  // type-coverage:ignore-next-line -- the driver types rows as any
  return (params === undefined ? statement.all() : statement.all(params)) as T[];
}

export function queryGet<T>(db: BetterSqlite3.Database, sql: string, ...params: readonly unknown[]): T | undefined {
  const statement = db.prepare(sql);
  // type-coverage:ignore-next-line -- the driver types rows as any
  return statement.get(...params) as T | undefined;
}

export function run(db: BetterSqlite3.Database, sql: string, ...params: readonly unknown[]): void {
  db.prepare(sql).run(...params);
}

export function runNamed(db: BetterSqlite3.Database, sql: string, params: Record<string, unknown>): void {
  db.prepare(sql).run(params);
}
