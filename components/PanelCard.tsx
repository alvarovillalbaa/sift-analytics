'use client';

import { useId } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Database, GripVertical, LoaderCircle, MoreHorizontal, Table2, X } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Panel, Value } from '../lib/types';

const COLORS = ['#8370df', '#b4a6ed', '#80b9ae', '#e8bc88', '#94abcc', '#df9ead'];

export function formatValue(value: Value | undefined, format: Panel['format'] = 'number', compact = false): string {
  if (value === null || value === undefined) return '—';
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return String(value);
  if (format === 'percent') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(numeric)}%`;
  return new Intl.NumberFormat('en-US', {
    style: format === 'currency' ? 'currency' : 'decimal',
    ...(format === 'currency' ? { currency: 'USD' } : {}),
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : format === 'currency' ? 0 : 2,
  }).format(numeric);
}

function readable(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function axisLabel(value: unknown): string {
  const label = String(value ?? '');
  if (/^\d{4}-\d{2}(?:-\d{2})?/.test(label)) {
    const date = new Date(label.slice(0, 10));
    if (!Number.isNaN(date.valueOf())) return date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  }
  return label.length > 15 ? `${label.slice(0, 13)}…` : label;
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return 'Refresh unknown';
  if (elapsed < 60_000) return 'Just refreshed';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Props = {
  panel: Panel;
  onInspect: (panel: Panel) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
};

export default function PanelCard({ panel, onInspect, onRemove, loading = false }: Props) {
  const chartId = useId().replace(/:/g, '');
  const rows = panel.result?.rows ?? [];
  const columns = panel.result?.columns ?? [];
  const xKey = panel.xKey ?? columns[0] ?? '';
  const numeric = (value: Value | undefined) => typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
  const yKeys = panel.yKeys?.length ? panel.yKeys : columns.filter((column) => column !== xKey && rows.some((row) => numeric(row[column])));
  const metricKey = panel.yKeys?.[0] ?? columns.find((column) => typeof rows[0]?.[column] === 'number') ?? columns[0];
  const metricValue = metricKey ? rows[0]?.[metricKey] : null;
  const sourceNames = panel.result?.sources.map((source) => source.name).join(', ') ?? '';
  const isMetric = panel.type === 'metric';
  const hasData = rows.length > 0;
  const changeKey = columns.find((column) => /^(change|change_pct|growth|growth_pct)$/.test(column));
  const change = changeKey && typeof rows[0]?.[changeKey] === 'number' ? rows[0][changeKey] as number : undefined;
  const tooltip = (
    <Tooltip
      contentStyle={{ border: '1px solid #e5dfee', borderRadius: 12, boxShadow: '0 8px 28px #28233b10', padding: '10px 14px', fontSize: 13, color: '#292732' }}
      labelStyle={{ color: '#6b6878', marginBottom: 5, fontSize: 12 }}
      formatter={(value, name) => [formatValue(typeof value === 'number' || typeof value === 'string' ? value : null, panel.format), readable(String(name))]}
      cursor={panel.type === 'bar' ? { fill: '#f6f4fd' } : { stroke: '#ded7f2', strokeDasharray: '4 4' }}
    />
  );
  const axes = <>
    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#eeeef3" />
    <XAxis dataKey={xKey} axisLine={false} tickLine={false} tickMargin={12} minTickGap={24} tick={{ fill: '#6b6878', fontSize: 12 }} tickFormatter={axisLabel} />
    <YAxis axisLine={false} tickLine={false} width={59} tickMargin={8} tick={{ fill: '#6b6878', fontSize: 12 }} tickFormatter={(value) => formatValue(Number(value), panel.format, true)} />
  </>;

  function renderChart() {
    const common = { data: rows, margin: { top: 10, right: 10, bottom: 0, left: -5 }, accessibilityLayer: true };
    if (panel.type === 'donut') {
      return <div className="donut-layout"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%" minHeight={110}>
        <PieChart accessibilityLayer>
          <Pie data={rows} dataKey={yKeys[0] ?? metricKey} nameKey={xKey} innerRadius="66%" outerRadius="88%" paddingAngle={4} stroke="none" cornerRadius={5}>
            {rows.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          {tooltip}
        </PieChart>
      </ResponsiveContainer><div className="donut-center"><span>Distribution</span><strong>{rows.length}</strong><small>segments</small></div></div>
      <div className="donut-legend">{rows.slice(0, 8).map((row, index) => <div key={index}><span className="legend-dot" style={{ background: COLORS[index % COLORS.length] }} /><span>{String(row[xKey] ?? 'Unknown')}</span><strong>{formatValue(row[yKeys[0] ?? metricKey], panel.format, true)}</strong></div>)}</div></div>;
    }
    if (panel.type === 'bar') return <ResponsiveContainer width="100%" height="100%" minHeight={110}><BarChart {...common}>{axes}{tooltip}
      {yKeys.map((key, index) => <Bar key={key} dataKey={key} name={readable(key)} fill={COLORS[index % COLORS.length]} radius={[5, 5, 0, 0]} maxBarSize={38} />)}
      {yKeys.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />}
    </BarChart></ResponsiveContainer>;
    if (panel.type === 'line') return <ResponsiveContainer width="100%" height="100%" minHeight={110}><LineChart {...common}>{axes}{tooltip}
      {yKeys.map((key, index) => <Line key={key} type="monotone" dataKey={key} name={readable(key)} stroke={COLORS[index % COLORS.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />)}
      {yKeys.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />}
    </LineChart></ResponsiveContainer>;
    return <ResponsiveContainer width="100%" height="100%" minHeight={110}><AreaChart {...common}>
      <defs>{yKeys.map((key, index) => <linearGradient key={key} id={`${chartId}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.2} /><stop offset="100%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.015} /></linearGradient>)}</defs>
      {axes}{tooltip}
      {yKeys.map((key, index) => <Area key={key} type="monotone" dataKey={key} name={readable(key)} stroke={COLORS[index % COLORS.length]} strokeWidth={2.5} fill={`url(#${chartId}-${index})`} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />)}
      {yKeys.length > 1 && <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />}
    </AreaChart></ResponsiveContainer>;
  }

  return <article className={`panel-card ${isMetric ? 'panel-metric' : ''} ${panel.error ? 'panel-has-error' : ''}`} aria-label={panel.title} aria-busy={loading}>
    <header className="panel-header">
      <div className="panel-heading"><span className="panel-drag-handle" title="Drag to rearrange"><GripVertical size={13} aria-hidden="true" /></span><h2>{panel.title}</h2></div>
      <div className="panel-actions"><button className="icon-button panel-menu" onClick={() => onInspect(panel)} aria-label={`Inspect ${panel.title}`} title="View query and data"><MoreHorizontal size={17} /></button><button className="icon-button panel-remove" onClick={() => onRemove(panel.id)} aria-label={`Remove ${panel.title}`} title="Remove panel"><X size={13} /></button></div>
    </header>

    {loading ? <div className="panel-state"><LoaderCircle size={20} className="spin" /><span>Querying your data…</span></div>
      : panel.error ? <div className="panel-state panel-error"><AlertCircle size={23} /><strong>We couldn’t run this query</strong><p>{panel.error}</p><button className="text-button" onClick={() => onInspect(panel)}>Review query</button></div>
      : !hasData ? <div className="panel-state"><Table2 size={24} /><strong>No matching data</strong><p>Try adjusting the query or adding a dataset.</p><button className="text-button" onClick={() => onInspect(panel)}>View query</button></div>
      : isMetric ? <div className="metric-body"><div className="metric-value">{formatValue(metricValue, panel.format)}</div><div className="metric-context">{change !== undefined && <span className={`metric-change ${change < 0 ? 'negative' : ''}`}>{change < 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{Math.abs(change).toFixed(1)}%</span>}<span>{panel.description || readable(metricKey ?? 'Query result')}</span></div></div>
      : panel.type === 'table' ? <div className="panel-table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{readable(column)}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className={typeof row[column] === 'number' ? 'numeric' : ''}>{formatValue(row[column], /revenue|amount|sales|value|mrr/i.test(column) ? panel.format : 'number')}</td>)}</tr>)}</tbody></table>{rows.length > 100 && <p className="field-help">Showing 100 of {rows.length} result rows. Open the source inspector to export all rows.</p>}</div>
      : !yKeys.length ? <div className="panel-state"><Table2 size={24} /><strong>This chart needs a numeric column</strong><p>Include a numeric measure and a label column in the query.</p><button className="text-button" onClick={() => onInspect(panel)}>Review query</button></div>
      : <div className="panel-chart" role="img" aria-label={`${panel.type} chart of ${yKeys.map(readable).join(', ')} by ${readable(xKey)}`}>{renderChart()}</div>}

    {!isMetric && panel.description && <p className="panel-description">{panel.description}</p>}
    <footer className="panel-footer"><button className="panel-source" onClick={() => onInspect(panel)} title={sourceNames || 'View query provenance'} aria-label={`View sources for ${panel.title}`}><Database size={10} aria-hidden="true" /><span>{sourceNames || 'Connected data'}</span></button><button className="panel-query-link" onClick={() => onInspect(panel)} title="View SQL, freshness, and result details">{panel.result ? <>{panel.result.truncated && <span className="result-warning">Limited</span>}{panel.result.approximate && <span className="result-warning">Approx.</span>}<span title={panel.result.executedAt}>{relativeTime(panel.result.executedAt)}</span><span className="query-dot">·</span>{panel.result.elapsedMs}ms</> : 'View query'}</button></footer>
  </article>;
}
