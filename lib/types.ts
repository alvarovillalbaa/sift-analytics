export type Value = string | number | boolean | null;
export type Column = { name: string; type: string };
export type Dataset = {
  id: string; name: string; table: string; sourceId: string;
  kind: 'demo' | 'file' | 'postgres'; columns: Column[];
  rowCount: number; updatedAt: string;
};
export type QueryResult = {
  columns: string[]; rows: Record<string, Value>[]; rowCount: number;
  truncated: boolean; elapsedMs: number; sql: string; executedAt: string;
  sources: { name: string; refreshedAt: string }[]; approximate: boolean;
};
export type Panel = {
  id: string; title: string;
  type: 'metric' | 'line' | 'bar' | 'area' | 'donut' | 'table';
  sql: string; datasetIds: string[]; xKey?: string; yKeys?: string[];
  format?: 'number' | 'currency' | 'percent'; description?: string;
  result?: QueryResult; error?: string;
  layout?: { i: string; x: number; y: number; w: number; h: number };
};
export type View = { id: string; name: string; description: string; panels: Panel[]; createdAt?: string };
export type Metric = { id: string; name: string; definition: string; sql: string; datasetIds: string[] };
export type Workspace = {
  datasets: Dataset[]; views: View[]; activeViewId: string;
  metrics: Metric[]; shareResults: boolean; shareSchema: boolean;
};
export type ConnectorCapabilities = {
  discovery: boolean; modes: ('file' | 'live-query' | 'semantic' | 'sync' | 'federation' | 'stream')[];
  readOnly: boolean; cancellation: boolean; deadline: boolean;
  resultLimit: number; executionLocation: 'browser' | 'server' | 'worker';
};
export interface AnalyticsConnector {
  id: string; name: string; capabilities: ConnectorCapabilities;
  discover(signal?: AbortSignal): Promise<Dataset[]>;
  query(sql: string, datasets: Dataset[], signal?: AbortSignal): Promise<QueryResult>;
  close(): Promise<void>;
}
