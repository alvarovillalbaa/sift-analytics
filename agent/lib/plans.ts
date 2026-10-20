import { randomUUID } from 'node:crypto';
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
  if (!/^(select|with)\b/i.test(normalized)) throw new Error('Analytics plans require a SELECT query.');
  // Execution performs its own dialect-aware permission checks in the connector.
  // This conservative planner guard rejects side-effecting and external-access plans early.
  const tokens = normalized.replace(/'(?:''|[^'])*'/g, "''");
  if (/;|--|\/\*|\*\//.test(tokens)
    || /\b(insert|update|delete|drop|create|alter|copy|attach|detach|install|load|pragma|call|execute|export|import|grant|revoke|truncate|set|reset|vacuum|analyze|merge)\b/i.test(tokens)
    || /\b(read_\w+|scan_\w+|\w+_scan|httpfs|glob|query|query_table|pg_\w+|information_schema|sqlite_master)\b/i.test(tokens)) {
    throw new Error('Use one read-only query over approved datasets, without external or system access.');
  }
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
