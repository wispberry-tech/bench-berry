// packages/ws-db/mod.ts
// Database workspace plugin: Postgres introspection via `npm:pg`.
// Ownership lives in the berry-bench monorepo; see packages/core/workspace.ts
// for the plugin contract and packages/core/config.ts for resolution rules.
import { Client } from "pg";
import { join } from "@std/path";
import type { WorkspacePlugin } from "../core/workspace.ts";

export interface DbColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  primaryKey: boolean;
}

export interface DbForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface DbTable {
  name: string;
  schema: string;
  rowCount?: number;
  columns: DbColumn[];
  foreignKeys: DbForeignKey[];
}

export interface DbSnapshot {
  error?: string;
  connection?: { host: string; database: string };
  tables: DbTable[];
}

// Driver-boundary row shapes: pg ships no bundled types (Deno npm compat
// resolves it as `any`), so each query result is annotated and mapped to one
// of these before the pure assembler runs.
export interface TableRow { schema: string; name: string; }
export interface ColRow {
  schema: string;
  table: string;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}
export interface PkRow { schema: string; table: string; column: string; }
export interface FkRow {
  schema: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
}
export interface CountRow { schema: string; name: string; est: number; }

// BASE TABLEs only (no views, sequences, or system schemas). This is the
// authoritative table list: tables with zero columns still appear here, so
// they survive assembly with empty columns/foreignKeys.
const TABLES_QUERY = `
  SELECT table_schema AS schema, table_name AS name
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name
`;

// Column metadata per table, ordered by ordinal_position so UI order is
// stable. `is_nullable` is text on the wire ("YES"/"NO") -> mapped to a
// boolean at the driver boundary.
const COLUMNS_QUERY = `
  SELECT table_schema AS schema, table_name AS table, column_name AS name,
         data_type AS type, is_nullable AS nullable, column_default AS default
  FROM information_schema.columns
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  ORDER BY table_schema, table_name, ordinal_position
`;

// Primary-key columns; one row per (table, column).
const PKS_QUERY = `
  SELECT tc.table_schema AS schema, tc.table_name AS table, kcu.column_name AS column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
`;

// Foreign keys; constraint_column_usage resolves the referenced table/column
// names on the constraint name, so multi-column constraints stay aligned
// row-for-row between kcu and ccu.
const FKS_QUERY = `
  SELECT tc.table_schema AS schema, tc.table_name AS table, kcu.column_name AS column,
         ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
`;

// Row-count estimates straight from pg_class (reltuples), avoiding a COUNT(*)
// scan per snapshot. The value is a float4; ::bigint keeps the wire type int8
// so pg parses it as a string (see load()). Negative values mean the table
// was never analyzed -> rowCount omitted.
const COUNTS_QUERY = `
  SELECT n.nspname AS schema, c.relname AS name, c.reltuples::bigint AS est
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
`;

// Pure assembler: driver rows -> DbTable[], keyed by schema + name. No pg
// dependency, so it is unit-testable without a database.
export function assembleTables(rows: {
  tables: TableRow[];
  columns: ColRow[];
  pks: PkRow[];
  fks: FkRow[];
  counts: CountRow[];
}): DbTable[] {
  const { tables, columns, pks, fks, counts } = rows;
  const pkKeys = new Set(pks.map((k) => `${k.schema}.${k.table}.${k.column}`));
  const byKey = new Map<string, DbTable>();
  for (const t of tables) {
    const tableKey = `${t.schema}.${t.name}`;
    const table: DbTable = { name: t.name, schema: t.schema, columns: [], foreignKeys: [] };
    byKey.set(tableKey, table);
  }
  for (const c of columns) {
    const table = byKey.get(`${c.schema}.${c.table}`);
    if (table === undefined) continue; // column without a listed table: drop
    const col: DbColumn = {
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      primaryKey: pkKeys.has(`${c.schema}.${c.table}.${c.name}`),
    };
    if (c.default !== null) col.default = c.default;
    table.columns.push(col);
  }
  for (const f of fks) {
    const table = byKey.get(`${f.schema}.${f.table}`);
    if (table === undefined) continue;
    table.foreignKeys.push({ column: f.column, referencesTable: f.refTable, referencesColumn: f.refColumn });
  }
  for (const c of counts) {
    const table = byKey.get(`${c.schema}.${c.name}`);
    if (table === undefined) continue;
    if (c.est >= 0) table.rowCount = c.est; // negative = never analyzed
  }
  return [...byKey.values()];
}

export const dbPlugin: WorkspacePlugin<DbSnapshot> = {
  id: "db",
  label: "Database",
  icon: "i-db",
  defaultEnabled: false,
  requiredDeps: ["BERRYBENCH_DATABASE_URL"],

  // Detection: a configured URL, or a repo-shaped db/ dir (migrations/
  // schema SQL). A db/-only repo loads into the documented no-connection
  // error state until BERRYBENCH_DATABASE_URL points at a live database.
  async detect(ctx) {
    if (ctx.env["BERRYBENCH_DATABASE_URL"]) return true;
    try {
      return (await Deno.stat(join(ctx.root, "db"))).isDirectory;
    } catch {
      return false;
    }
  },

  // load() NEVER throws: every failure path resolves to a snapshot carrying an
  // `error` string (documented §5 "missing data source" state).
  async load(ctx) {
    const conn = ctx.env["BERRYBENCH_DATABASE_URL"];
    if (!conn) {
      return {
        tables: [],
        error: "no database connection configured (set BERRYBENCH_DATABASE_URL)",
      };
    }

    let client: Client | undefined;
    try {
      client = new Client({ connectionString: conn });
      // Swallow connection-level error events (backend drop mid-query) so a
      // failing session can never crash the process with an uncaught 'error'.
      client.on("error", () => {});
      await client.connect();

      // Five queries, run in order. Every row shape is annotated at the driver
      // boundary (pg ships no bundled types) and mapped to the query-specific
      // row interface before the pure assembler builds DbTables.
      const tablesRes = await client.query(TABLES_QUERY);
      const tables: TableRow[] = tablesRes.rows.map(
        (row: { schema: string; name: string }) => ({ schema: row.schema, name: row.name }),
      );

      const columnsRes = await client.query(COLUMNS_QUERY);
      // is_nullable is text on the wire: "YES"/"NO" -> boolean.
      const colRows: ColRow[] = columnsRes.rows.map((row: {
        schema: string;
        table: string;
        name: string;
        type: string;
        nullable: string;
        default: string | null;
      }) => ({
        schema: row.schema,
        table: row.table,
        name: row.name,
        type: row.type,
        nullable: row.nullable === "YES",
        default: row.default,
      }));

      const pksRes = await client.query(PKS_QUERY);
      const pkRows: PkRow[] = pksRes.rows.map(
        (row: { schema: string; table: string; column: string }) => ({
          schema: row.schema,
          table: row.table,
          column: row.column,
        }),
      );

      const fksRes = await client.query(FKS_QUERY);
      const fkRows: FkRow[] = fksRes.rows.map((row: {
        schema: string;
        table: string;
        column: string;
        ref_table: string;
        ref_column: string;
      }) => ({
        schema: row.schema,
        table: row.table,
        column: row.column,
        refTable: row.ref_table,
        refColumn: row.ref_column,
      }));

      const countsRes = await client.query(COUNTS_QUERY);
      // reltuples::bigint is int8 on the wire -> pg parses it as a STRING;
      // Number() converts so the snapshot carries a JS number.
      const countRows: CountRow[] = countsRes.rows.map(
        (row: { schema: string; name: string; est: string }) => ({
          schema: row.schema,
          name: row.name,
          est: Number(row.est),
        }),
      );

      const params = client.connectionParameters;
      return {
        connection: {
          host: params.host ?? "",
          database: params.database ?? "",
        },
        tables: assembleTables({ tables, columns: colRows, pks: pkRows, fks: fkRows, counts: countRows }),
      };
    } catch (err) {
      return {
        tables: [],
        error: "database connection failed: " + (err as Error).message,
      };
    } finally {
      // Close on every path that may hold an open connection; if teardown
      // itself fails, never let it escape the catch and turn into a throw.
      if (client) await client.end().catch(() => {});
    }
  },
};