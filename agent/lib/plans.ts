import { randomUUID } from 'node:crypto';
import SqlParser from 'node-sql-parser';
import { z } from 'zod';

const identifier = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const datasetId = z.string().min(1).max(300).regex(/^[a-zA-Z0-9_.:-]+$/);
const query = {
  id: identifier.optional(),
  title: z.string().min(1).max(120),
  sql: z.string().min(1).max(12_000),
  datasetIds: z.array(datasetId).min(1).max(12),
};

export const panelSchema = z.object({
  ...query,
  type: z.enum(['metric', 'line', 'bar', 'area', 'donut', 'table']),
  xKey: z.string().min(1).max(100).optional(),
  yKeys: z.array(z.string().min(1).max(100)).max(8).optional(),
  format: z.enum(['number', 'currency', 'percent']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  description: z.string().max(1_000).optional(),
});

export const viewPlanSchema = z.object({
  id: identifier.optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(2_000),
  panels: z.array(panelSchema).min(1).max(12),
});

export const analysisPlanSchema = z.object({ queries: z.array(z.object(query)).min(1).max(6) });

function readOnlySql(sql: string): string {
  const normalized = sql.trim().replace(/;\s*$/, '');
  let ast: unknown;
  try {
    ast = new SqlParser.Parser().astify(normalized, { database: 'Postgresql' });
  } catch {
    throw new Error('Use one SELECT or WITH query in the supported SQL syntax.');
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw new Error('Analytics plans require one SELECT query.');
    ast = ast[0];
  }
  function assertSelect(statement: unknown): void {
    if (!statement || typeof statement !== 'object' || !('type' in statement) || statement.type !== 'select') {
      throw new Error('Every query and CTE in an analytics plan must be a SELECT.');
    }
    const select = statement as Record<string, unknown>;
    if (select.into && typeof select.into === 'object'
      && Object.values(select.into).some((value) => value !== null && value !== undefined)) {
      throw new Error('SELECT INTO is not permitted in an analytics plan.');
    }
    if (Array.isArray(select.with)) {
      for (const cte of select.with) assertSelect(cte?.stmt);
    }
    if (select._next) assertSelect(select._next);
  }
  // Dataset scopes and callable functions are checked by the execution connector.
  assertSelect(ast);
  return normalized;
}

export function validatedViewPlan(input: z.infer<typeof viewPlanSchema>) {
  return {
    ...input,
    id: input.id ?? randomUUID(),
    panels: input.panels.map((panel) => ({ ...panel, id: panel.id ?? randomUUID(), sql: readOnlySql(panel.sql) })),
  };
}

export function validatedAnalysisPlan(input: z.infer<typeof analysisPlanSchema>) {
  return { queries: input.queries.map((item) => ({ ...item, id: item.id ?? randomUUID(), sql: readOnlySql(item.sql) })) };
}
