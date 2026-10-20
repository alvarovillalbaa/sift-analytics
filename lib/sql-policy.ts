import SqlParser from 'node-sql-parser';

export const QUERY_ROW_LIMIT = 1000;
export const QUERY_TIMEOUT_MS = 10_000;
export const MAX_SQL_LENGTH = 20_000;

const FUNCTIONS = new Set([
  'abs', 'avg', 'ceil', 'ceiling', 'coalesce', 'concat', 'concat_ws', 'count',
  'date_part', 'date_trunc', 'datediff', 'date_diff', 'day', 'dense_rank', 'exp',
  'first_value', 'floor', 'greatest', 'lag', 'last_value', 'lead', 'least',
  'length', 'ln', 'log', 'log10', 'lower', 'ltrim', 'max', 'median', 'min',
  'month', 'nullif', 'percent_rank', 'power', 'rank', 'replace', 'round',
  'row_number', 'rtrim', 'sign', 'sqrt', 'stddev', 'stddev_pop', 'stddev_samp',
  'substring', 'substr', 'sum', 'trim', 'upper', 'variance', 'var_pop',
  'var_samp', 'year', 'now', 'current_date', 'current_timestamp',
]);
const CAST_TYPES = new Set([
  'BIGINT', 'BINARY', 'BOOL', 'BOOLEAN', 'CHAR', 'CHARACTER', 'DATE', 'DECIMAL',
  'DOUBLE', 'DOUBLE PRECISION', 'FLOAT', 'FLOAT4', 'FLOAT8', 'INT', 'INT2',
  'INT4', 'INT8', 'INTEGER', 'INTERVAL', 'NUMERIC', 'REAL', 'SMALLINT', 'TEXT',
  'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'TINYINT', 'UBIGINT', 'UINTEGER', 'VARCHAR',
]);
type Node = Record<string, unknown>;
function record(value: unknown): value is Node {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value: unknown): string {
  if (typeof value === 'string') return value;
  if (record(value) && typeof value.value === 'string') return value.value;
  throw new Error('This query uses an unsupported identifier.');
}

/** Parse, validate, then regenerate SQL so permissions apply to the executed AST. */
export function analyzeReadOnlySql(
  sql: string,
  allowedTables: readonly string[],
  _dialect: 'duckdb' | 'postgres' = 'duckdb',
): { sql: string; tables: string[] } {
  if (!sql.trim()) throw new Error('Enter a SELECT query.');
  if (sql.length > MAX_SQL_LENGTH) throw new Error('Queries must be shorter than 20,000 characters.');
  const parser = new SqlParser.Parser();
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: 'Postgresql' });
  } catch {
    throw new Error('Use one SELECT or WITH query in the supported SQL syntax.');
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw new Error('Only one read-only query can run at a time.');
    ast = ast[0];
  }
  const approved = new Set(allowedTables);
  const referenced = new Set<string>();
  let visited = 0;

  function visit(value: unknown, scope: Set<string>, depth: number): void {
    if (++visited > 12_000 || depth > 80) throw new Error('Simplify this query before running it.');
    if (Array.isArray(value)) { for (const item of value) visit(item, scope, depth + 1); return; }
    if (!record(value)) return;
    if (value.type === 'select') { visitSelect(value, scope, depth + 1); return; }
    if (['insert', 'update', 'delete', 'create', 'drop', 'alter', 'call', 'execute', 'copy', 'set', 'transaction'].includes(String(value.type))) {
      throw new Error('Only read-only SELECT queries are permitted.');
    }
    if (['function', 'aggr_func', 'window_func'].includes(String(value.type))) {
      let name: string;
      if (typeof value.name === 'string') name = value.name;
      else if (record(value.name) && value.name.schema == null && Array.isArray(value.name.name) && value.name.name.length === 1) {
        name = identifier(value.name.name[0]);
      } else throw new Error('Schema-qualified and external functions are not permitted.');
      if (!FUNCTIONS.has(name.toLowerCase())) throw new Error(`Function “${name}” is not in the analytical function allowlist.`);
    }
    if (value.type === 'cast') {
      if (!Array.isArray(value.target) || value.target.some((target) => !record(target)
        || !CAST_TYPES.has(String(target.dataType).toUpperCase()))) {
        throw new Error('Only standard analytical data type casts are permitted.');
      }
    }
    for (const child of Object.values(value)) visit(child, scope, depth + 1);
  }

  function visitSelect(select: Node, inheritedScope: Set<string>, depth: number): void {
    if (select.type !== 'select') throw new Error('Every query and CTE must be a SELECT.');
    const scope = new Set(inheritedScope);
    if (select.into && record(select.into) && Object.values(select.into).some((value) => value !== null && value !== undefined)) {
      throw new Error('SELECT INTO is not permitted.');
    }
    if (Array.isArray(select.with)) {
      for (const cte of select.with) {
        if (!record(cte) || cte.recursive) throw new Error('Recursive queries are not permitted.');
        if (!record(cte.stmt) || cte.stmt.type !== 'select') throw new Error('Every CTE must be a read-only SELECT.');
        visitSelect(cte.stmt, scope, depth + 1);
        scope.add(identifier(cte.name));
      }
    }
    if (select.from) {
      if (!Array.isArray(select.from)) throw new Error('Unsupported query source.');
      for (const source of select.from) {
        if (!record(source)) throw new Error('Unsupported query source.');
        if (typeof source.table === 'string') {
          const name = source.db ? `${identifier(source.db)}.${source.table}` : source.table;
          if (!(source.db == null && scope.has(source.table)) && !approved.has(name)) {
            throw new Error(`Dataset “${name}” is not approved for this query.`);
          }
          if (!(source.db == null && scope.has(source.table))) referenced.add(name);
        } else if (!record(source.expr) || !record(source.expr.ast) || source.expr.ast.type !== 'select') {
          throw new Error('Table functions, files, URLs, and external sources are not permitted in queries.');
        }
        visit(source, scope, depth + 1);
      }
    }
    for (const [key, child] of Object.entries(select)) {
      if (key !== 'with' && key !== 'from' && key !== 'into') visit(child, scope, depth + 1);
    }
  }

  if (!record(ast) || ast.type !== 'select') throw new Error('Only read-only SELECT queries are permitted.');
  visitSelect(ast, new Set(), 0);
  // Regeneration quotes identifiers consistently, including mixed-case names.
  return {
    sql: parser.sqlify(ast as unknown as Parameters<typeof parser.sqlify>[0], { database: 'Postgresql' }).replace(/;\s*$/, ''),
    tables: [...referenced],
  };
}

export function validateReadOnlySql(sql: string, allowedTables: readonly string[], dialect: 'duckdb' | 'postgres' = 'duckdb'): string {
  return analyzeReadOnlySql(sql, allowedTables, dialect).sql;
}
