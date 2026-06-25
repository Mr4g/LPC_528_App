declare module 'better-sqlite3' {
  namespace Database {
    interface Statement {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    }
    interface Database {
      pragma(sql: string): unknown;
      exec(sql: string): unknown;
      prepare(sql: string): Statement;
      close(): void;
    }
  }

  interface DatabaseConstructor {
    new (filename: string): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
