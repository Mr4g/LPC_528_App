declare module 'better-sqlite3' {
  export interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string): unknown;
  }

  export default class BetterSqlite3Database implements Database {
    constructor(filename: string);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string): unknown;
  }
}
