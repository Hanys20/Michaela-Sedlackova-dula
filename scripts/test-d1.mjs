// A D1-shaped adapter over real SQLite, including atomic batch rollback.
export function testD1(sqlite) {
  function execute({ sql, values }) {
    const statement = sqlite.prepare(sql);
    const returnsRows = /^\s*(SELECT|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
    if (returnsRows) {
      const results = statement.all(...values);
      const changes = /\bRETURNING\b/i.test(sql) ? sqlite.prepare('SELECT changes() AS changes').get().changes : 0;
      return { success: true, results, meta: { changes } };
    }
    const result = statement.run(...values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  return {
    prepare(sql) {
      return {
        sql, values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) ?? null; },
        async all() { return execute(this); },
        async run() { return execute(this); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(execute);
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
