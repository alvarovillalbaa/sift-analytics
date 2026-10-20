'use client';

import { useRef } from 'react';
import { LayoutDashboard, Sparkles } from 'lucide-react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout/legacy';
import type { Panel } from '../lib/types';
import PanelCard from './PanelCard';

const ResponsiveGrid = WidthProvider(Responsive);

type Props = {
  panels: Panel[];
  onLayoutChange: (panels: Panel[]) => void;
  onInspect: (panel: Panel) => void;
  onRemove: (id: string) => void;
  loading?: boolean;
};

export default function DashboardGrid({ panels, onLayoutChange, onInspect, onRemove, loading }: Props) {
  const breakpoint = useRef('lg');
  const desktop = panels.map((panel, index) => ({
    ...(panel.layout ?? { i: panel.id, x: (index % 3) * 4, y: Math.floor(index / 3) * 5, w: panel.type === 'metric' ? 4 : 6, h: panel.type === 'metric' ? 3 : 5 }),
    i: panel.id,
    minW: panel.type === 'metric' ? 3 : 4,
    minH: panel.type === 'metric' ? 3 : 4,
  }));
  let mobileY = 0;
  const mobile = panels.map((panel) => {
    const h = panel.layout?.h ?? (panel.type === 'metric' ? 3 : 5);
    const item = { i: panel.id, x: 0, y: mobileY, w: 1, h, minW: 1, minH: panel.type === 'metric' ? 3 : 4 };
    mobileY += h;
    return item;
  });

  function saveLayout(layout: Layout) {
    const items = new Map(layout.map((item) => [item.i, item]));
    const mobileLayout = breakpoint.current === 'sm';
    const ordered = mobileLayout ? [...panels].sort((a, b) => (items.get(a.id)?.y ?? 0) - (items.get(b.id)?.y ?? 0)) : panels;
    onLayoutChange(ordered.map((panel) => {
      const item = items.get(panel.id);
      if (!item) return panel;
      const previous = desktop.find((entry) => entry.i === panel.id)!;
      return { ...panel, layout: { i: panel.id, x: mobileLayout ? previous.x : item.x, y: mobileLayout ? previous.y : item.y, w: mobileLayout ? previous.w : item.w, h: item.h } };
    }));
  }

  if (!panels.length) return <div className="dashboard-empty"><div className="empty-icon"><LayoutDashboard size={25} /></div><h2>A fresh perspective starts here.</h2><p>Ask Sift to build a dashboard, explore a question, or turn your data into something useful.</p><span><Sparkles size={13} /> Try “Create a revenue overview” below</span></div>;

  return <div className="dashboard-grid" aria-label="Dashboard panels">
    <ResponsiveGrid
      className="dashboard-layout"
      breakpoints={{ lg: 920, md: 640, sm: 0 }}
      cols={{ lg: 12, md: 12, sm: 1 }}
      layouts={{ lg: desktop, md: desktop, sm: mobile }}
      rowHeight={48}
      margin={[18, 18]}
      containerPadding={[0, 0]}
      draggableHandle=".panel-drag-handle"
      draggableCancel="button, a, input, textarea"
      compactType="vertical"
      resizeHandles={['se']}
      onBreakpointChange={(value) => { breakpoint.current = value; }}
      onDragStop={(layout) => saveLayout(layout)}
      onResizeStop={(layout) => saveLayout(layout)}
    >
      {panels.map((panel) => <div key={panel.id}><PanelCard panel={panel} onInspect={onInspect} onRemove={onRemove} loading={loading} /></div>)}
    </ResponsiveGrid>
  </div>;
}
