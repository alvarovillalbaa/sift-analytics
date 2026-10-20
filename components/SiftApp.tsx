'use client';

import { useEffect, useRef, useState } from 'react';
import { useEveAgent } from 'eve/react';
import { ArrowDownToLine, ArrowUp, Check, ChevronDown, ChevronRight, Database, FileSpreadsheet, Filter, Code2, LayoutDashboard, LoaderCircle, Menu, MessageSquare, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react';
import DashboardGrid from './DashboardGrid';
import { defaultWorkspace } from '@/lib/demo';
import { initEngine, importFile, query, deleteDataset, listWorkbookSheets, getRestoreErrors } from '@/lib/engine';
import { loadWorkspace, saveWorkspace } from '@/lib/storage';
import type { Dataset, Panel, QueryResult, View, Workspace } from '@/lib/types';

type Modal = 'sources' | 'settings' | 'metrics' | 'panel' | 'new-view' | null;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default function SiftApp() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [ready, setReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const datasets = await initEngine();
        const warnings = getRestoreErrors();
        const saved = loadWorkspace() ?? defaultWorkspace();
        saved.datasets = [...datasets, ...saved.datasets.filter(d => d.kind === 'postgres')];
        if (active) { setWorkspace(saved); setReady(true); if (warnings.length) setToast(`Some files could not be restored: ${warnings.join('; ')}`); }
      } catch (error) { if (active) setToast(`Data engine: ${errorText(error)}. Reload to try again.`); }
    })();
    void fetch('/api/session', { method: 'POST' }).then(r => {
      if (!r.ok) throw new Error('AI session is unavailable. Your local dashboards still work.');
      if (active) setAuthReady(true);
    }).catch(error => { if (active) setToast(errorText(error)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!workspace || !ready) return;
    try { saveWorkspace(workspace); } catch (error) { setToast(`Could not save workspace: ${errorText(error)}`); }
  }, [workspace, ready]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 8000); return () => clearTimeout(timer); }, [toast]);
  if (!workspace) return <div className="boot-screen"><div className="brand-mark"><Filter size={25} /></div><h1>Sift</h1><p>{toast || 'Preparing your workspace…'}</p>{!toast && <LoaderCircle className="spin" size={20} />}</div>;
  return <WorkspaceApp key={authReady ? 'agent-ready' : 'local-only'} workspace={workspace} setWorkspace={setWorkspace} authReady={authReady} toast={toast} notify={setToast} />;
}

function WorkspaceApp({ workspace, setWorkspace, authReady, toast, notify }: {
  workspace: Workspace; setWorkspace: React.Dispatch<React.SetStateAction<Workspace | undefined>>;
  authReady: boolean; toast: string; notify: (text: string) => void;
}) {
  const [modal, setModal] = useState<Modal>(null);
  const [inspect, setInspect] = useState<Panel>();
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [localNotes, setLocalNotes] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [pgStatus, setPgStatus] = useState('');
  const [file, setFile] = useState<File>();
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [newName, setNewName] = useState('');
  const [sql, setSql] = useState('SELECT * FROM demo_revenue LIMIT 20');
  const [panelType, setPanelType] = useState<Panel['type']>('table');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [metricName, setMetricName] = useState('');
  const [metricDefinition, setMetricDefinition] = useState('');
  const processed = useRef(new Set<string>((() => { try { return JSON.parse(localStorage.getItem('sift-applied-tools') ?? '[]') as string[]; } catch { return []; } })()));
  const pendingSummary = useRef<Record<string, unknown>[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem('sift-chat') ?? 'null'); } catch { return null; } });
  const agent = useEveAgent({
    initialSession: authReady ? saved?.session : undefined, initialEvents: saved?.events ?? [], resume: authReady && Boolean(saved?.session), followIdle: false,
    onFinish(snapshot) { try { localStorage.setItem('sift-chat', JSON.stringify({ session: snapshot.session, events: snapshot.events })); } catch { /* The workspace remains available if chat history exceeds device storage. */ } },
    onError(error) { notify(`AI: ${errorText(error)}`); },
  });
  useEffect(() => {
    if (!agent.session) return;
    const timer = setTimeout(() => { try { localStorage.setItem('sift-chat', JSON.stringify({ session: agent.session, events: agent.events })); } catch { /* Device storage may be full. */ } }, 250);
    return () => clearTimeout(timer);
  }, [agent.session, agent.events]);
  const busy = agent.status === 'submitted' || agent.status === 'streaming' || agent.status === 'resuming';
  const activeView = workspace.views.find(v => v.id === workspace.activeViewId) ?? workspace.views[0];
  function update(fn: (value: Workspace) => Workspace) { setWorkspace(current => current ? fn(current) : current); }
  async function runQuery(statement: string, datasetIds: string[], signal?: AbortSignal) {
    const datasets = workspaceRef.current.datasets.filter(d => datasetIds.includes(d.id));
    if (!datasets.length) throw new Error('Choose at least one available dataset.');
    if (datasets.some(d => d.kind === 'postgres')) {
      if (datasets.some(d => d.kind !== 'postgres')) throw new Error('Local and database data need an approved shared engine before joining.');
      const response = await fetch('/api/postgres', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token || sessionStorage.getItem('sift-pg-token') || ''}` }, body: JSON.stringify({ sql: statement, datasetIds }), signal });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as QueryResult;
    }
    return query(statement, datasets, signal);
  }
  async function evaluate(panels: Panel[]) {
    const controller = new AbortController(); abortRef.current = controller; setLoading(true);
    const results: Panel[] = [];
    try {
      for (const panel of panels) {
        if (controller.signal.aborted) break;
        try { results.push({ ...panel, result: await runQuery(panel.sql, panel.datasetIds, controller.signal), error: undefined }); }
        catch (error) { results.push({ ...panel, result: undefined, error: errorText(error) }); }
      }
      return results;
    } finally { setLoading(false); abortRef.current = null; }
  }
  async function refresh(view: View) {
    const panels = await evaluate(view.panels);
    update(w => ({ ...w, views: w.views.map(v => v.id === view.id ? { ...v, panels: v.panels.map(p => ({ ...p, ...panels.find(r => r.id === p.id) })) } : v) }));
  }
  useEffect(() => {
    if (activeView?.panels.some(p => !p.result && !p.error)) void refresh(activeView);
    // A view is evaluated when selected; subsequent refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView?.id]);
  function context() {
    const w = workspaceRef.current;
    return JSON.parse(JSON.stringify({ shareSchema: w.shareSchema, shareResults: w.shareResults,
      datasets: w.shareSchema ? w.datasets.map(({ id, name, table, columns, kind, updatedAt }) => ({ id, name, table, columns, kind, updatedAt })) : [],
      metrics: w.shareSchema ? w.metrics : [], activeView: activeView?.name,
    }));
  }
  async function send(message = text) {
    if (!message.trim() || busy || executing) return;
    if (!authReady) { notify('AI is not connected. You can still upload data and create SQL panels.'); return; }
    if (!workspace.shareSchema) { setModal('settings'); notify('Enable schema sharing to let AI work with your selected datasets.'); return; }
    setText(''); setChatOpen(true);
    try { await agent.send(message.trim(), { clientContext: context() }); } catch (error) { notify(errorText(error)); }
  }
  useEffect(() => {
    for (const message of agent.data.messages) for (const part of message.parts) {
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available' || part.partial || processed.current.has(part.toolCallId)) continue;
      processed.current.add(part.toolCallId);
      try { localStorage.setItem('sift-applied-tools', JSON.stringify([...processed.current].slice(-1000))); } catch { /* Applied plans remain deduplicated for this tab. */ }
      if (part.toolName === 'create_view') {
        const output = part.output as View;
        if (!output?.panels?.length) continue;
        setExecuting(true);
        void (async () => {
          const panels = await evaluate(output.panels.map((p, i) => ({ ...p, id: crypto.randomUUID(), layout: { i: '', x: i % 2 * 6, y: Math.floor(i / 2) * 5, w: p.type === 'metric' ? 4 : 6, h: p.type === 'metric' ? 3 : 5 } })));
          const view: View = { ...output, id: crypto.randomUUID(), panels, createdAt: new Date().toISOString() };
          update(w => ({ ...w, views: [...w.views, view], activeViewId: view.id })); notify(`Created “${view.name}” with ${panels.length} panels.`); setExecuting(false);
        })().catch(error => { notify(errorText(error)); setExecuting(false); });
      }
      if (part.toolName === 'analyze_data') {
        const output = part.output as { queries?: { id: string; title: string; sql: string; datasetIds: string[] }[] };
        if (!output?.queries?.length) continue;
        setExecuting(true);
        const controller = new AbortController(); abortRef.current = controller;
        void (async () => {
          const results: (QueryResult & { title: string; datasetIds: string[] } | { title: string; error: string })[] = [];
          for (const plan of output.queries!) {
            if (controller.signal.aborted) break;
            try { results.push({ title: plan.title, datasetIds: plan.datasetIds, ...(await runQuery(plan.sql, plan.datasetIds, controller.signal)) }); }
            catch (error) { results.push({ title: plan.title, error: errorText(error) }); }
          }
          const panels: Panel[] = results.filter((r): r is QueryResult & {title:string;datasetIds:string[]} => 'rows' in r).map(r => ({ id: crypto.randomUUID(), title: r.title, type: 'table', sql: r.sql, datasetIds: r.datasetIds, result: r }));
          if (panels.length) { const view: View = { id: crypto.randomUUID(), name: output.queries![0].title, description: 'Reproducible results from your conversation.', panels }; update(w => ({ ...w, views: [...w.views, view], activeViewId: view.id })); }
          if (workspaceRef.current.shareResults) pendingSummary.current = results.map(r => 'rows' in r ? { ...r, rows: r.rows.slice(0, 50), modelRowsLimited: r.rows.length > 50 } : r);
          else setLocalNotes(notes => [...notes, 'Your analysis results are ready in a new view. To get an AI explanation, enable query-result sharing in Settings, then ask about the result.']);
          setExecuting(false);
        })().catch(error => { notify(errorText(error)); setExecuting(false); }).finally(() => { if (abortRef.current === controller) abortRef.current = null; });
      }
    }
  }, [agent.data.messages]); // Tool call IDs prevent durable replay from applying a plan twice.
  useEffect(() => {
    if (agent.status !== 'ready' || executing || !pendingSummary.current) return;
    const results = pendingSummary.current; pendingSummary.current = null;
    if (!workspaceRef.current.shareResults) return;
    const bounded = JSON.parse(JSON.stringify(results));
    if (JSON.stringify(bounded).length > 60000) { notify('Results are too large to share. Use a smaller aggregate query.'); return; }
    void agent.send('Explain the locally executed results in clientContext.results. Do not call planning tools again. Ground every quantitative claim in the supplied evidence and disclose limitations.', { clientContext: { ...context(), results: bounded } }).catch(error => notify(errorText(error)));
  }, [agent.status, executing]);
  async function chooseFile(value?: File) {
    setFile(value); setSheets([]); setSheet('');
    if (value && /\.xlsx$/i.test(value.name)) {
      try { const names = await listWorkbookSheets(value); setSheets(names); setSheet(names[0] ?? ''); } catch (error) { notify(errorText(error)); }
    }
  }
  async function upload() {
    if (!file) return; setLoading(true);
    try {
      const dataset = await importFile(file, sheet || undefined);
      update(w => ({ ...w, datasets: [...w.datasets.filter(d => d.id !== dataset.id), dataset], shareSchema: false, shareResults: false }));
      setFile(undefined); setSheets([]); notify(`“${dataset.name}” is ready. Your file stays on this device. Schema sharing is now off.`);
    } catch (error) { notify(errorText(error)); } finally { setLoading(false); }
  }
  async function connectPostgres() {
    setPgStatus('Connecting…');
    try {
      const response = await fetch('/api/postgres', { headers: { authorization: `Bearer ${token}` } }); const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (!body.configured) { setPgStatus('No database is configured on this deployment. Add SIFT_POSTGRES_CONNECTIONS and SIFT_ACCESS_TOKEN on your self-hosted instance or in Vercel.'); return; }
      sessionStorage.setItem('sift-pg-token', token);
      update(w => ({ ...w, datasets: [...w.datasets.filter(d => d.kind !== 'postgres'), ...body.datasets], shareSchema: false, shareResults: false }));
      setPgStatus(`Connected ${body.datasets.length} approved tables. Enable schema sharing in Settings to analyze with AI.`);
    } catch (error) { setPgStatus(errorText(error)); }
  }
  async function addPanel() {
    if (!newName.trim() || !selectedIds.length || !activeView) return;
    const panel: Panel = { id: crypto.randomUUID(), title: newName, type: panelType, sql, datasetIds: selectedIds, layout: { i: '', x: 0, y: Math.max(0, ...activeView.panels.map(p => (p.layout?.y ?? 0) + (p.layout?.h ?? 5))), w: panelType === 'metric' ? 4 : 6, h: panelType === 'metric' ? 3 : 5 } };
    const results = await evaluate([panel]); update(w => ({ ...w, views: w.views.map(v => v.id === activeView.id ? { ...v, panels: [...v.panels, ...results] } : v) })); setModal(null); setNewName('');
  }
  function close() { setModal(null); setInspect(undefined); }
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); setChatOpen(false); setMobileNav(false); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const suggestions = ['Create a revenue dashboard', 'Which channels drive the most revenue?', 'Show revenue by region'];
  return <div className={`app-shell ${mobileNav ? 'nav-open' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark"><Filter size={22} strokeWidth={2.8} /></span><span>sift<span className="brand-dot">.</span></span></a>
      <button className="workspace-switch" onClick={() => setModal('settings')}><span className="workspace-avatar">S</span><span>My workspace<small>Personal workspace</small></span><ChevronDown size={14} /></button>
      <div className="nav-section-label">WORKSPACE</div>
      <button className="nav-item" onClick={() => { setModal('sources'); setMobileNav(false); }}><Database size={17} />Data sources<span className="nav-count">{workspace.datasets.length}</span></button>
      <button className="nav-item" onClick={() => { setModal('metrics'); setMobileNav(false); }}><Filter size={17} />Metric definitions</button>
      <div className="nav-section-label views-label"><span>YOUR VIEWS</span><button className="icon-button" aria-label="Create view" onClick={() => { setNewName(''); setModal('new-view'); }}><Plus size={15} /></button></div>
      <nav aria-label="Saved views">{workspace.views.map(view => <button key={view.id} className={`nav-item ${view.id === activeView?.id ? 'active' : ''}`} onClick={() => { update(w => ({ ...w, activeViewId: view.id })); setMobileNav(false); }}><LayoutDashboard size={17} /><span>{view.name}</span></button>)}</nav>
      <button className="new-view-link" onClick={() => { setNewName(''); setModal('new-view'); }}><Plus size={15} />Create a view</button>
      <div className="sidebar-bottom"><div className="local-badge"><ShieldCheck size={18} /><div>Your data, your space<small>Files stay on this device</small></div></div><button className="nav-item" onClick={() => setModal('settings')}><Settings2 size={17} />Settings</button><a className="nav-item" href="https://github.com/alvarovillalbaa/sift-analytics" target="_blank" rel="noreferrer"><Code2 size={17} />Open source<ArrowUp size={13} style={{ transform: 'rotate(45deg)', marginLeft: 'auto' }} /></a><div className="profile"><span className="profile-avatar">Y</span><div>Your workspace<small>Local & private by default</small></div><ChevronDown size={14} /></div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button><LayoutDashboard size={16} /><span>Views</span><ChevronRight size={13} /><strong>{activeView?.name ?? 'Workspace'}</strong></div><div className="topbar-right"><span className="status-dot" />Saved on this device<button className={`icon-button ${chatOpen ? 'selected' : ''}`} aria-label="Toggle conversation" onClick={() => setChatOpen(!chatOpen)}><MessageSquare size={18} /></button></div></header>
      <div className={`workspace-content ${chatOpen ? 'with-chat' : ''}`}>
        <section className="dashboard-content"><div className="view-header"><div><div className="eyebrow"><span className="status-dot" />{workspace.datasets.every(d => d.kind === 'demo') ? 'SAMPLE WORKSPACE' : 'YOUR DATA WORKSPACE'}</div><h1>{activeView?.name ?? 'Your next insight starts here'}<span className="title-dot">.</span></h1><p>{activeView?.description ?? 'Connect a source and ask your first question.'}</p></div><div className="view-actions"><button className="button" onClick={() => activeView && refresh(activeView)} disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Refresh</button><button className="button" onClick={() => activeView && download(`${activeView.name.toLowerCase().replaceAll(' ', '-')}.json`, JSON.stringify(activeView, null, 2))} disabled={!activeView}><ArrowDownToLine size={15} />Export</button><button className="button button-primary" onClick={() => { setNewName(''); setSelectedIds(workspace.datasets[0] ? [workspace.datasets[0].id] : []); setModal('panel'); }}><Plus size={16} />Add panel</button></div></div>
          <div className="view-meta"><span><Database size={14} />{workspace.datasets.length} dataset{workspace.datasets.length !== 1 ? 's' : ''}</span><span className="meta-divider" /><span>Live calculations</span><span className="meta-spacer" /><span className="drag-hint">Drag to rearrange · resize from the corner</span>{workspace.views.length > 1 && <button className="icon-button" aria-label="Delete current view" onClick={() => { update(w => ({ ...w, views: w.views.filter(v => v.id !== activeView.id), activeViewId: w.views.find(v => v.id !== activeView.id)!.id })); }}><Trash2 size={14} /></button>}</div>
          {activeView?.panels.length ? <DashboardGrid panels={activeView.panels} loading={loading} onInspect={setInspect} onRemove={id => update(w => ({ ...w, views: w.views.map(v => v.id === activeView.id ? { ...v, panels: v.panels.filter(p => p.id !== id) } : v) }))} onLayoutChange={panels => update(w => ({ ...w, views: w.views.map(v => v.id === activeView.id ? { ...v, panels } : v) }))} /> : <div className="empty-workspace"><span className="empty-icon"><LayoutDashboard size={28} /></span><h2>A blank canvas. A better question.</h2><p>Ask Sift to build a dashboard, or add your first SQL panel.</p><button className="button button-primary" onClick={() => { setText('Create a dashboard for my data'); document.getElementById('sift-prompt')?.focus(); }}><Sparkles size={16} />Start with a question</button></div>}
          <div className="workspace-footnote"><ShieldCheck size={14} />Every chart starts with a query. Click a panel’s source to see the evidence.<span>Powered by DuckDB + eve</span></div>
        </section>
        {chatOpen && <aside className="conversation"><div className="conversation-header"><span><Sparkles size={17} />Your data partner</span><div><button className="icon-button" aria-label="New conversation" disabled={busy} onClick={() => { agent.reset(); localStorage.removeItem('sift-chat'); setLocalNotes([]); }}><Plus size={17} /></button><button className="icon-button" aria-label="Close conversation" onClick={() => setChatOpen(false)}><X size={17} /></button></div></div><div className="conversation-messages" aria-live="polite">{!agent.data.messages.length && <div className="chat-welcome"><span className="empty-icon"><Sparkles size={24} /></span><h3>Let’s find the signal.</h3><p>Ask a question, explore a trend, or turn your data into a whole new view.</p></div>}{agent.data.messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}><small>{message.role === 'user' ? 'YOU' : 'SIFT'}</small>{message.parts.map((part, i) => part.type === 'text' ? <p key={i}>{part.text}</p> : part.type === 'dynamic-tool' ? <div className="tool-activity" key={i}>{part.state === 'output-available' ? <Check size={14} /> : <LoaderCircle size={14} className="spin" />}{part.toolName === 'create_view' ? 'Designing your view' : 'Planning your analysis'}</div> : null)}</div>)}{localNotes.map((note, i) => <div className="chat-message assistant" key={i}><p>{note}</p></div>)}{(busy || executing) && <div className="thinking"><span /><span /><span /><small>{executing ? 'Running queries locally' : 'Working with your data'}</small></div>}{agent.error && <div className="inline-error">{agent.error.message}<button className="button" onClick={() => { agent.reset(); localStorage.removeItem('sift-chat'); }}>Start a new conversation</button></div>}{Object.values(agent.data.inputs).filter(input => input.status === 'open').map(input => <div key={input.request.requestId} className="inline-notice"><p>{input.request.prompt}</p>{input.request.options?.map(option => <button className="button" key={option.id} disabled={agent.status === 'resuming'} onClick={() => void agent.respond([{ requestId: input.request.requestId, optionId: option.id }]).catch(error => notify(errorText(error)))}>{option.label}</button>)}</div>)}</div></aside>}
      </div>
      <div className="composer-shell"><div className="prompt-suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => void send(suggestion)} disabled={busy || executing}><Sparkles size={13} />{suggestion}</button>)}</div><form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><span className="composer-spark"><Sparkles size={20} /></span><textarea id="sift-prompt" rows={1} placeholder="Ask your data anything, or describe a dashboard…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} maxLength={6000} aria-label="Ask Sift" /><button type="button" className="icon-button" aria-label="Connect data" onClick={() => setModal('sources')}><Plus size={20} /></button>{busy || loading || executing ? <button type="button" className="send-button" aria-label="Stop current work" onClick={() => { abortRef.current?.abort(); if (busy) void agent.cancel().catch(error => notify(errorText(error))); }}><Square size={14} fill="currentColor" /></button> : <button type="submit" className="send-button" aria-label="Send question" disabled={!text.trim()}><ArrowUp size={19} /></button>}</form><div className="composer-caption"><span><span className="status-dot" />{workspace.shareSchema ? 'Schema sharing on' : 'Schema sharing off'} · {workspace.shareResults ? 'Query results shared with AI' : 'Query results stay local'}</span><span>Built with <a href="https://eve.dev" target="_blank" rel="noreferrer">eve</a> <span className="key-hint">↵</span> to send</span></div></div>
    </main>
    {toast && <div role="status" className="toast">{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => notify('')}><X size={15} /></button></div>}
    {(modal || inspect) && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section role="dialog" aria-modal="true" aria-label={inspect ? inspect.title : modal ?? 'Dialog'} className={`dialog ${modal === 'sources' || inspect ? 'dialog-wide' : ''}`}><div className="dialog-header"><div><div className="eyebrow">YOUR WORKSPACE</div><h2>{inspect ? inspect.title : modal === 'sources' ? 'Bring your data' : modal === 'settings' ? 'Privacy & workspace' : modal === 'metrics' ? 'Define what matters' : modal === 'panel' ? 'Create a panel' : 'Create a view'}</h2></div><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
      {inspect && <><p>{inspect.description || 'This panel is calculated from the query below.'}</p><label className="field">SQL query<pre className="sql-block">{inspect.sql}</pre></label><div className="evidence-meta">{inspect.result ? <><span>Executed {new Date(inspect.result.executedAt).toLocaleString()}</span><span>{inspect.result.elapsedMs} ms · {inspect.result.rowCount} rows{inspect.result.truncated ? ' · truncated at 1,000 rows' : ' · complete result'}{inspect.result.approximate ? ' · approximate' : ''}</span>{inspect.result.sources.map(s => <span key={s.name}>{s.name} · refreshed {new Date(s.refreshedAt).toLocaleString()}</span>)}</> : <span>{inspect.error || 'This query has not run yet.'}</span>}</div>{inspect.result && <><div className="data-preview"><table><thead><tr>{inspect.result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{inspect.result.rows.slice(0, 20).map((row, i) => <tr key={i}>{inspect.result!.columns.map(c => <td key={c}>{String(row[c] ?? '—')}</td>)}</tr>)}</tbody></table></div><button className="button" onClick={() => download(`${inspect.title}.csv`, [inspect.result!.columns, ...inspect.result!.rows.map(row => inspect.result!.columns.map(c => row[c]))].map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'), 'text/csv')}><ArrowDownToLine size={15} />Export result CSV</button></>}</>}
      {modal === 'sources' && <><p>Upload a file for private, local analysis, or connect a configured database.</p><div className="upload-zone"><FileSpreadsheet size={30} /><strong>Start with a file</strong><span>CSV, TSV, JSON, JSONL, XLSX or Parquet · up to 20 MB</span><input aria-label="Choose a data file" type="file" accept=".csv,.tsv,.json,.jsonl,.xlsx,.parquet" onChange={e => void chooseFile(e.target.files?.[0])} />{sheets.length > 0 && <select aria-label="Workbook sheet" value={sheet} onChange={e => setSheet(e.target.value)}>{sheets.map(s => <option key={s}>{s}</option>)}</select>}{file && <button className="button button-primary" onClick={() => void upload()} disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Import {file.name}</button>}</div><div className="section-heading"><h3>Connected datasets</h3><span>{workspace.datasets.length} sources</span></div><div className="dataset-list">{workspace.datasets.map(d => <div className="dataset-card" key={d.id}><span className="dataset-icon">{d.kind === 'postgres' ? <Database size={21} /> : <FileSpreadsheet size={21} />}</span><div><strong>{d.name}</strong><small>{d.kind === 'demo' ? 'Sample data' : d.kind === 'postgres' ? 'Read-only PostgreSQL' : 'Stored on this device'} · {d.rowCount < 0 ? 'Live rows' : `${d.rowCount.toLocaleString()} rows`} · {d.columns.length} columns</small><code>{d.table}</code><small>Refreshed {new Date(d.updatedAt).toLocaleString()}</small></div>{d.kind !== 'demo' && <button className="icon-button" aria-label={`Remove ${d.name}`} onClick={() => void (async () => { if (d.kind === 'file') await deleteDataset(d.id); update(w => ({ ...w, datasets: w.datasets.filter(ds => ds.id !== d.id) })); })().catch(error => notify(errorText(error)))}><Trash2 size={15} /></button>}</div>)}</div><div className="postgres-connection"><h3><Database size={17} />PostgreSQL</h3><p>Your deployment administrator configures approved read-only connections. Credentials stay on the server.</p><div className="inline-fields"><input className="input" type="password" autoComplete="off" placeholder="Deployment access token" aria-label="PostgreSQL deployment access token" value={token} onChange={e => setToken(e.target.value)} /><button className="button" onClick={() => void connectPostgres()}>Connect</button></div>{pgStatus && <p className="inline-notice">{pgStatus}</p>}</div><a className="text-link" href="https://github.com/alvarovillalbaa/sift-analytics/blob/main/docs/connectors.md" target="_blank" rel="noreferrer">Build another connector with the SDK <ChevronRight size={14} /></a></>}
      {modal === 'settings' && <><p>Your dashboards and uploaded files are stored in this browser. AI conversations run on this deployment’s model provider.</p><label className="toggle-row"><div><strong>Share dataset schemas with AI</strong><small>Table names, column names, types and metric definitions. Your uploaded file is never sent.</small></div><input type="checkbox" checked={workspace.shareSchema} onChange={e => update(w => ({ ...w, shareSchema: e.target.checked }))} /></label><label className="toggle-row"><div><strong>Share query results for explanations</strong><small>Allow up to 50 result rows per query to be sent to the AI and stored in conversation history. Results may contain raw values.</small></div><input type="checkbox" checked={workspace.shareResults} onChange={e => update(w => ({ ...w, shareResults: e.target.checked }))} /></label><div className="inline-notice"><ShieldCheck size={18} /><span>Files are scoped to this browser and origin. Export your views before clearing browser data. Private-network access requires a self-hosted deployment.</span></div><button className="button" onClick={() => download('sift-workspace.json', JSON.stringify(workspace, null, 2))}><ArrowDownToLine size={16} />Export workspace definitions & results</button></>}
      {modal === 'new-view' && <form onSubmit={event => { event.preventDefault(); if (!newName.trim()) return; const view: View = { id: crypto.randomUUID(), name: newName.trim(), description: 'A new perspective on your data.', panels: [] }; update(w => ({ ...w, views: [...w.views, view], activeViewId: view.id })); close(); }}><label className="field">View name<input className="input" autoFocus value={newName} onChange={e => setNewName(e.target.value)} maxLength={80} placeholder="e.g. Customer growth" required /></label><button className="button button-primary" type="submit"><Plus size={16} />Create view</button></form>}
      {modal === 'panel' && <form onSubmit={event => { event.preventDefault(); void addPanel(); }}><label className="field">Title<input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Monthly revenue" required /></label><label className="field">Visualization<select className="input" value={panelType} onChange={e => setPanelType(e.target.value as Panel['type'])}>{['table', 'metric', 'area', 'line', 'bar', 'donut'].map(t => <option key={t}>{t}</option>)}</select></label><label className="field">Approved datasets<select className="input" multiple value={selectedIds} onChange={e => setSelectedIds([...e.target.selectedOptions].map(o => o.value))} required>{workspace.datasets.map(d => <option value={d.id} key={d.id}>{d.name} ({d.table})</option>)}</select></label><label className="field">Read-only SQL<textarea className="input sql-input" value={sql} onChange={e => setSql(e.target.value)} required spellCheck={false} /></label><p className="field-help">SELECT and WITH queries only. Results are limited to 1,000 rows and 10 seconds.</p><button className="button button-primary" disabled={loading} type="submit">{loading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Run & add panel</button></form>}
      {modal === 'metrics' && <><p>Give AI an explicit business definition to use. Definitions belong to this workspace and are shared only when schema sharing is enabled.</p>{workspace.metrics.map(metric => <div className="metric-definition" key={metric.id}><div><strong>{metric.name}</strong><p>{metric.definition}</p><code>{metric.sql}</code></div><button className="icon-button" aria-label={`Remove ${metric.name}`} onClick={() => update(w => ({ ...w, metrics: w.metrics.filter(m => m.id !== metric.id) }))}><Trash2 size={15} /></button></div>)}<form onSubmit={event => { event.preventDefault(); update(w => ({ ...w, metrics: [...w.metrics, { id: crypto.randomUUID(), name: metricName, definition: metricDefinition, sql, datasetIds: selectedIds.length ? selectedIds : w.datasets.slice(0, 1).map(d => d.id) }] })); setMetricName(''); setMetricDefinition(''); }}><label className="field">Metric name<input className="input" value={metricName} onChange={e => setMetricName(e.target.value)} placeholder="Net revenue" required /></label><label className="field">Approved definition<textarea className="input" value={metricDefinition} onChange={e => setMetricDefinition(e.target.value)} placeholder="Revenue after refunds, in USD, recognized by invoice date…" required /></label><label className="field">Datasets<select className="input" multiple value={selectedIds.length ? selectedIds : workspace.datasets.slice(0, 1).map(d => d.id)} onChange={e => setSelectedIds([...e.target.selectedOptions].map(o => o.value))} required>{workspace.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="field">SQL expression<input className="input" value={sql} onChange={e => setSql(e.target.value)} required /></label><button className="button button-primary" type="submit"><Plus size={16} />Save definition</button></form></>}
    </section></div>}
  </div>;
}
