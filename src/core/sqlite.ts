import * as sqlite from 'node:sqlite'

export interface SqlStatement {
  run(...args: unknown[]): unknown
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

export function openDatabase(filename: string): SqlDatabase {
  const mod = sqlite as unknown as {
    DatabaseSync?: new (path: string) => SqlDatabase
    Database?: new (path: string) => SqlDatabase
  }
  const Ctor = mod.DatabaseSync ?? mod.Database
  if (!Ctor) throw new Error('This runtime does not include node:sqlite.')
  const db = new Ctor(filename)
  db.exec('PRAGMA foreign_keys = ON')
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  return db
}
