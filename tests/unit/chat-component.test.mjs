// T2: actual WorkspaceApp body/callbacks/effects with actual native selectors
// and app persistence. Hooks, messages, SQL results and JSX are authored state.
// This does not execute React lifecycle, DOM, DuckDB, transport or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as events from 'eve/events';
import * as legacy from 'eve/internal/legacy-events';
import { loadTypescript, memoryStorage } from '../support/load-typescript.mjs';

const archive = loadTypescript('lib/chat-archive.ts', { 'eve/events': events, 'eve/internal/legacy-events': legacy });
const panelForm = loadTypescript('lib/panel-form.ts', {});
const panelResults = loadTypescript('lib/panel-results.ts', {});
const raw = readFileSync(new URL('../../scripts/fixtures/legacy-chat.json', import.meta.url), 'utf8').trim();
const wire = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const turnId = 'authored-turn';
const base = [
  { type: 'session.started', data: {} },
  { type: 'delivery.admitted', data: { deliveryId: 'authored-delivery' } },
  { type: 'turn.started', scope: { turnId }, data: { turnId, follows: null, cause: { deliveryId: 'authored-delivery' } } },
  { type: 'delivery.consumed', scope: { turnId }, data: { deliveryId: 'authored-delivery', turnId, parts: [{ kind: 'text', text: 'Authored analysis' }] } },
];
function viewOf(facts) {
  return events.foldEvents(events.emptySessionView(), wire(facts).map((fact, line) => ({ ...fact, meta: { at: '2026-11-14T00:00:00.000Z', position: { line, index: 0 }, endOfLine: true } })));
}
function paused(kind = 'approval') {
  return viewOf([...base,
    { type: 'interaction.opened', scope: { turnId }, data: { interactionId: 'authored-choice', subject: { turnId }, request: { kind, prompt: 'Authored choice', allowFreeform: kind === 'question', options: [{ id: 'approve', label: 'Continue' }] } } },
    { type: 'turn.paused', scope: { turnId }, data: { turnId, awaiting: [{ interactionId: 'authored-choice' }] } },
    { type: 'delivery.settled', scope: { turnId }, data: { deliveryId: 'authored-delivery', turnId, outcome: 'handled' } },
  ]);
}
const completed = () => viewOf([...base,
  { type: 'turn.settled', scope: { turnId }, data: { turnId, outcome: 'completed', reply: [] } },
  { type: 'delivery.settled', scope: { turnId }, data: { deliveryId: 'authored-delivery', turnId, outcome: 'handled' } },
]);
const queryResult = { columns: ['total'], columnTypes: { total: 'INTEGER' }, rows: Array.from({ length: 55 }, (_, total) => ({ total })), rowCount: 55, elapsedMs: 1, truncated: false, sources: [], executedAt: '2026-11-14T00:00:00.000Z' };
const plan = { title: 'Authored analysis', sql: 'SELECT 1 AS total', datasetIds: ['demo'] };
const part = (name, output, callId = 'authored-call') => ({ type: 'tool', kind: 'tool', name, label: 'Authored tool', state: 'completed', callId, stepIndex: 0, output });

function harness({ view = completed(), status = 'idle', messages = [], storage = memoryStorage(), authReady = true, shareResults = false, query = async () => queryResult, receipts = [] } = {}) {
  const calls = [], states = [], refs = [], effects = [], timers = new Map(); let stateIndex = 0, refIndex = 0, options, timerId = 0;
  const initial = { 2: true, 4: 'Authored question' };
  let workspace = { datasets: [{ id: 'demo', table: 'demo', name: 'Authored sample', columns: [], kind: 'demo', updatedAt: '2026-11-14' }], views: [{ id: 'initial', name: 'Sample', panels: [] }], activeViewId: 'initial', metrics: [], appliedToolCallIds: receipts, shareSchema: true, shareResults };
  const agent = { view, status, messages, events: [], session: { sessionId: 'authored-session', streamIndex: 0 }, error: undefined,
    send: async (...args) => { calls.push(['send', wire(args)]); }, respond: async (...args) => { calls.push(['respond', wire(args)]); },
    cancel: async () => { calls.push(['cancel']); }, newSession: () => { calls.push(['newSession']); agent.session = undefined; agent.events = []; agent.messages = []; },
  };
  const globals = { localStorage: storage, AbortController, FormData: class { constructor(form) { this.form = form; } get(key) { return this.form[key]; } },
    fetch() { throw new Error('Network forbidden in authored component checks'); },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    window: { addEventListener() {}, removeEventListener() {} },
  };
  const component = loadTypescript('components/SiftApp.tsx', {
    react: {
      useState(value) { const index = stateIndex++; if (!(index in states)) states[index] = index in initial ? initial[index] : typeof value === 'function' ? value() : value; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
      useRef(value) { return refs[refIndex++] ||= { current: value }; }, useEffect(fn, deps) { effects.push({ fn, deps }); },
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'eve/react': { useEveAgent(value) { options = value; return agent; } }, 'eve/events': events,
    'lucide-react': new Proxy({}, { get: (_, key) => `Icon:${String(key)}` }),
    './DashboardGrid': { default: 'DashboardGrid' }, './LocalImport': { default: 'LocalImport' }, '@/lib/demo': {},
    '@/lib/engine': { query }, '@/lib/storage': {}, '@/lib/panel-form': panelForm, '@/lib/panel-results': panelResults, '@/lib/chat-archive': archive,
  }, globals, '\nexport { WorkspaceApp as FixtureWorkspace };');
  return { calls, states, agent, storage, effects, timers, get options() { return options; }, get workspace() { return workspace; },
    render() { stateIndex = 0; refIndex = 0; effects.length = 0; return component.FixtureWorkspace({ workspace, setWorkspace(next) { workspace = typeof next === 'function' ? next(workspace) : next; }, authReady, toast: '', notify: message => calls.push(['notice', message]) }); },
  };
}
function nodes(value) { if (Array.isArray(value)) return value.flatMap(nodes); return value && typeof value === 'object' && value.props ? [value, ...nodes(value.props.children)] : []; }
function text(value) { if (Array.isArray(value)) return value.map(text).join(''); return value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' ? value : ''; }
function one(tree, predicate) { const result = nodes(tree).filter(predicate); assert.equal(result.length, 1); return result[0]; }
const button = (tree, label) => one(tree, node => node.type === 'button' && node.props['aria-label'] === label);

test('native messages and completed tool labels render without legacy wrappers', () => {
  const h = harness({ messages: [{ id: 'message', role: 'assistant', parts: [{ type: 'text', text: 'Authored explanation' }, part('create_view', {})] }] });
  const tree = h.render(); assert.match(text(tree), /Authored explanation/); assert.match(text(tree), /Authored tool · completed/);
});
test('paused turns remain followed, stoppable and block New and ordinary messages', async () => {
  const h = harness({ view: paused() }); let tree = h.render();
  assert.equal(events.idle(h.agent.view), true); assert.ok(events.activeTurn(h.agent.view));
  assert.equal(h.options.followWhile(h.agent.view), true); assert.equal(h.options.followWhile(completed()), false);
  assert.equal(button(tree, 'New conversation').props.disabled, true);
  button(tree, 'New conversation').props.onClick();
  one(tree, n => n.type === 'form' && n.props.className === 'composer').props.onSubmit({ preventDefault() {} });
  button(tree, 'Stop current work').props.onClick(); await tick();
  assert.deepEqual(h.calls, [['cancel']]); assert.doesNotMatch(text(tree), /Working with your data/);
});
test('approval, budget and question options send native interaction IDs while paused', async () => {
  for (const kind of ['approval', 'budget', 'question']) {
    const h = harness({ view: paused(kind) }); const tree = h.render();
    const choice = one(tree, n => n.type === 'button' && text(n) === 'Continue'); assert.equal(choice.props.disabled, false);
    choice.props.onClick(); await tick(); assert.deepEqual(h.calls, [['respond', [[{ interactionId: 'authored-choice', optionId: 'approve' }]]]]);
  }
});
test('freeform questions use a bounded native text answer and clear only after acceptance', async () => {
  const h = harness({ view: paused('question') }); const tree = h.render(); let reset = false;
  const input = one(tree, n => n.type === 'input' && n.props.name === 'answer'); assert.equal(input.props.maxLength, 6000);
  one(tree, n => n.type === 'form' && n.props.className !== 'composer').props.onSubmit({ preventDefault() {}, currentTarget: { answer: ' Authored answer ', reset() { reset = true; } } });
  await tick(); assert.deepEqual(h.calls, [['respond', [[{ interactionId: 'authored-choice', text: 'Authored answer' }]]]]); assert.equal(reset, true);
});
test('resuming and pending commands disable answers and prevent plan replay', () => {
  for (const status of ['resuming', 'busy']) {
    const h = harness({ status, view: paused(), messages: [{ id: 'tool', role: 'assistant', parts: [part('create_view', { name: 'Replay', panels: [{ ...plan, type: 'table' }] })] }] });
    const tree = h.render(); assert.equal(one(tree, n => n.type === 'button' && text(n) === 'Continue').props.disabled, true);
    if (status === 'resuming') { h.effects[3].fn(); assert.equal(h.workspace.views.length, 1); }
  }
});
test('invalid history and unavailable browser authentication prevent automatic tool application', () => {
  for (const options of [{ storage: memoryStorage({ 'sift-chat': '{' }) }, { authReady: false }]) {
    const h = harness({ ...options, messages: [{ id: 'tool', role: 'assistant', parts: [part('create_view', { name: 'Plan', panels: [{ ...plan, type: 'table' }] })] }] });
    h.render(); h.effects[3].fn(); assert.equal(h.workspace.views.length, 1);
  }
});
test('legacy plan replay is skipped, while the same call ID in an explicit new session is applied atomically once', async () => {
  const tool = part('create_view', { name: 'Plan', panels: [{ ...plan, type: 'table' }] });
  const h = harness({ storage: memoryStorage({ 'sift-chat': raw }), receipts: ['authored-call'], messages: [{ id: 'tool', role: 'assistant', parts: [tool] }] });
  let tree = h.render(); h.effects[3].fn(); assert.equal(h.workspace.views.length, 1);
  button(tree, 'New conversation').props.onClick(); assert.deepEqual(h.calls, [['newSession']]);
  h.agent.session = { sessionId: 'new-session', streamIndex: 0 }; h.agent.messages = [{ id: 'new-tool', role: 'assistant', parts: [tool] }];
  h.render(); h.effects[3].fn(); await tick(); h.render(); h.effects[3].fn();
  assert.equal(h.workspace.views.length, 2); assert.equal(h.workspace.views[1].id, 'eve-new-session:authored-call');
  assert.deepEqual(wire(h.workspace.appliedToolCallIds), ['authored-call', 'new-session:authored-call']);
});
test('result explanations wait for actual turn settlement and cap explicitly shared rows', async () => {
  const h = harness({ view: paused(), shareResults: true, messages: [{ id: 'tool', role: 'assistant', parts: [part('analyze_data', { queries: [plan] })] }] });
  h.render(); h.effects[3].fn(); await tick(); h.render(); h.effects[4].fn(); assert.deepEqual(h.calls, []);
  h.agent.view = completed(); h.render(); h.effects[4].fn(); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'send');
  const context = h.calls[0][1][1].clientContext; assert.equal(context.shareResults, true); assert.equal(context.results[0].rows.length, 50); assert.equal(context.results[0].modelRowsLimited, true);
});
test('result sharing remains opt-in and queued summaries are discarded when sharing is revoked', async () => {
  for (const shareResults of [false, true]) {
    const h = harness({ view: paused(), shareResults, messages: [{ id: 'tool', role: 'assistant', parts: [part('analyze_data', { queries: [plan] })] }] });
    h.render(); h.effects[3].fn(); await tick(); h.workspace.shareResults = false;
    h.agent.view = completed(); h.render(); h.effects[4].fn(); await tick();
    assert.equal(h.calls.filter(call => call[0] === 'send').length, 0);
  }
});
test('failed storage removal leaves the native conversation attached', () => {
  const storage = memoryStorage({ 'sift-chat': raw }); storage.removeItem = () => { throw new Error('Removal denied'); };
  const h = harness({ storage }); button(h.render(), 'New conversation').props.onClick();
  assert.deepEqual(h.calls, []); assert.ok(storage.getItem('sift-chat')); assert.match(h.states[17], /Removal denied/);
});
