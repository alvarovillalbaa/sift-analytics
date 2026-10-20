import type { Dataset, Metric, Panel, Workspace } from './types';

export const DEMO_TABLE = 'demo_revenue';
export const DEMO_DATASET_ID = 'demo-revenue';
export const DEMO_UPDATED_AT = '2026-01-01T00:00:00.000Z';

/** A repeatable sample, independent of the current date or a remote service. */
export function createDemoRows(): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  const channels = ['Organic', 'Paid search', 'Referral', 'Partners'];
  const plans = ['Starter', 'Growth', 'Enterprise'];
  const regions = ['North America', 'Europe', 'Asia Pacific'];
  for (let month = 1; month <= 12; month++) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      for (let planIndex = 0; planIndex < plans.length; planIndex++) {
        for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
          const customers = Math.round((17 + month * 2.7 + (3 - channelIndex) * 4 + regionIndex * 2)
            * [1.5, 1, 0.38][planIndex]);
          const price = [49, 149, 599][planIndex];
          rows.push({
            month: `2025-${String(month).padStart(2, '0')}-01`,
            channel: channels[channelIndex], plan: plans[planIndex], region: regions[regionIndex],
            customers, revenue: customers * price, new_customers: Math.round(customers * (0.12 + month / 180)),
          });
        }
      }
    }
  }
  return rows;
}

export const demoDataset: Dataset = {
  id: DEMO_DATASET_ID, name: 'SaaS revenue · sample', table: DEMO_TABLE,
  sourceId: 'demo', kind: 'demo', rowCount: 432, updatedAt: DEMO_UPDATED_AT,
  columns: [
    { name: 'month', type: 'DATE' }, { name: 'channel', type: 'VARCHAR' },
    { name: 'plan', type: 'VARCHAR' }, { name: 'region', type: 'VARCHAR' },
    { name: 'customers', type: 'BIGINT' }, { name: 'revenue', type: 'BIGINT' },
    { name: 'new_customers', type: 'BIGINT' },
  ],
};

const source = [DEMO_DATASET_ID];
const panels: Panel[] = [
  {
    id: 'total-revenue', title: 'Annual revenue', type: 'metric', datasetIds: source,
    sql: 'SELECT SUM(revenue) AS revenue FROM demo_revenue', format: 'currency',
    description: 'Recognized subscription revenue, Jan–Dec 2025. USD; no refunds or tax in this sample.',
    layout: { i: 'total-revenue', x: 0, y: 0, w: 4, h: 3 },
  },
  {
    id: 'active-customers', title: 'Active customers', type: 'metric', datasetIds: source,
    sql: "SELECT SUM(customers) AS customers FROM demo_revenue WHERE month = '2025-12-01'",
    format: 'number', description: 'Paying subscriptions at December 2025 month end; summed across mutually exclusive segments.',
    layout: { i: 'active-customers', x: 4, y: 0, w: 4, h: 3 },
  },
  {
    id: 'revenue-growth', title: 'Revenue growth', type: 'metric', datasetIds: source,
    sql: "SELECT ROUND(100.0 * (SUM(CASE WHEN month = '2025-12-01' THEN revenue ELSE 0 END) / NULLIF(SUM(CASE WHEN month = '2025-11-01' THEN revenue ELSE 0 END), 0) - 1), 1) AS growth FROM demo_revenue",
    format: 'percent', description: 'December revenue compared with November; percentage points expressed as a percentage.',
    layout: { i: 'revenue-growth', x: 8, y: 0, w: 4, h: 3 },
  },
  {
    id: 'revenue-trend', title: 'Revenue over time', type: 'area', datasetIds: source,
    sql: 'SELECT month, SUM(revenue) AS revenue FROM demo_revenue GROUP BY month ORDER BY month',
    xKey: 'month', yKeys: ['revenue'], format: 'currency', description: 'Monthly recognized revenue · USD',
    layout: { i: 'revenue-trend', x: 0, y: 3, w: 8, h: 5 },
  },
  {
    id: 'acquisition-channels', title: 'Acquisition mix', type: 'donut', datasetIds: source,
    sql: 'SELECT channel, SUM(new_customers) AS customers FROM demo_revenue GROUP BY channel ORDER BY customers DESC',
    xKey: 'channel', yKeys: ['customers'], format: 'number', description: 'New paying subscriptions acquired during 2025',
    layout: { i: 'acquisition-channels', x: 8, y: 3, w: 4, h: 5 },
  },
  {
    id: 'plan-breakdown', title: 'Performance by plan', type: 'table', datasetIds: source,
    sql: "SELECT plan, SUM(revenue) AS revenue, SUM(new_customers) AS new_customers, ROUND(SUM(revenue) * 1.0 / NULLIF(SUM(customers), 0), 2) AS monthly_revenue_per_customer FROM demo_revenue GROUP BY plan ORDER BY revenue DESC",
    format: 'currency', description: 'Annual totals and weighted monthly revenue per paying subscription · USD',
    layout: { i: 'plan-breakdown', x: 0, y: 8, w: 12, h: 5 },
  },
];

export const demoMetrics: Metric[] = [
  { id: 'recognized-revenue', name: 'Recognized revenue', definition: 'Sum of subscription revenue in USD for the selected period. Sample data excludes refunds and tax.', sql: 'SELECT SUM(revenue) AS revenue FROM demo_revenue', datasetIds: source },
  { id: 'active-subscriptions', name: 'Active customers', definition: 'Sum of active paying subscriptions for the latest available month. Monthly snapshots must not be summed across time.', sql: "SELECT SUM(customers) AS customers FROM demo_revenue WHERE month = (SELECT MAX(month) FROM demo_revenue)", datasetIds: source },
];

export function defaultWorkspace(): Workspace {
  return {
    datasets: [structuredClone(demoDataset)],
    views: [{ id: 'overview', name: 'Revenue overview', description: 'The big picture, down to the details.', panels: structuredClone(panels) }],
    activeViewId: 'overview', metrics: structuredClone(demoMetrics), shareResults: true, shareSchema: true,
  };
}
