// packages/ws-db/mod.ts
// Database workspace plugin: Postgres introspection via `npm:pg`.
// Ownership lives in the berry-bench monorepo; see packages/core/workspace.ts
// for the plugin contract and packages/core/config.ts for resolution rules.
import { Client } from 'pg';
import type { WorkspacePlugin } from '../core/workspace.ts';

export interface DbTable {
  name: string;
  columns: number;
}

export interface DbSnapshot {
  error?: string;
  connection?: { host: string; database: string };
  tables: DbTable[];
}

// BASE TABLEs only (no views, sequences, or system schemas), with a column
// count per table. COUNT() is int8 on the wire, so cast to ::int to get a JS
// number from pg's default type parser.
const TABLES_QUERY = `
  SELECT t.table_schema AS schema, t.table_name AS name,
         COUNT(c.column_name)::int AS columns
  FROM information_schema.tables t
  LEFT JOIN information_schema.columns c
    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
    AND t.table_type = 'BASE TABLE'
  GROUP BY t.table_schema, t.table_name
  ORDER BY t.table_name
`;

export const dbPlugin: WorkspacePlugin<DbSnapshot> = {
  id: 'db',
  label: 'Database',
  icon: 'i-db',
  defaultEnabled: false,
  requiredDeps: ['BERRYBENCH_DATABASE_URL'],

  // Cheap: pure env check, no I/O.
  detect(ctx) {
    return Promise.resolve(Boolean(ctx.env['BERRYBENCH_DATABASE_URL']));
  },

  // load() NEVER throws: every failure path resolves to a snapshot carrying an
  // `error` string (documented §5 "missing data source" state).
  async load(ctx) {
    const conn = ctx.env['BERRYBENCH_DATABASE_URL'];
    if (!conn) {
      return {
        tables: [],
        error: 'no database connection configured (set BERRYBENCH_DATABASE_URL)',
      };
    }

    let client: Client | undefined;
    try {
      client = new Client({ connectionString: conn });
      // Swallow connection-level error events (backend drop mid-query) so a
      // failing session can never crash the process with an uncaught 'error'.
      client.on('error', () => {});
      await client.connect();

      const res = await client.query(TABLES_QUERY);
      // pg ships no bundled types (Deno npm compat resolves it as `any`), so
      // annotate the row shape at the driver boundary: `name`/`schema` are
      // text, `columns` is `COUNT(...)::int` → parsed as a JS number.
      type TableRow = { schema: string; name: string; columns: number };
      const params = client.connectionParameters;
      return {
        connection: {
          host: params.host ?? '',
          database: params.database ?? '',
        },
        tables: res.rows.map((row: TableRow) => ({ name: row.name, columns: row.columns })),
      };
    } catch (err) {
      return {
        tables: [],
        error: 'database connection failed: ' + (err as Error).message,
      };
    } finally {
      // Close on every path that may hold an open connection; if teardown
      // itself fails, never let it escape the catch and turn into a throw.
      if (client) await client.end().catch(() => {});
    }
  },
};