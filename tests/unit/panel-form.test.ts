// T1: actual submission coordination with deferred authored results, not React or query-engine execution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPanelFormLease } from '../../lib/panel-form.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function panelDraft() {
  return { title: 'Panel A', sql: 'SELECT amount FROM sales', type: 'table', datasetIds: ['sales', 'customers'] };
}

test('PF01 an unchanged mounted form commits its complete result once before resetting', async () => {
  const lease = createPanelFormLease();
  const result = { rows: [0, false, null, ''], sql: 'SELECT amount FROM sales' };
  const query = deferred<typeof result>();
  const events: string[] = [];
  const committed: typeof result[] = [];
  let form: ReturnType<typeof panelDraft> | undefined = panelDraft();
  const pending = lease.submit({
    isMounted: () => true,
    evaluate: () => { events.push('evaluate'); return query.promise; },
    commit: value => { events.push('commit'); committed.push(value); },
    reset: () => { events.push('reset'); form = undefined; },
  });
  assert.deepEqual(events, ['evaluate']);
  assert.deepEqual(form, panelDraft());
  query.resolve(result);
  assert.equal(await pending, true);
  assert.deepEqual(events, ['evaluate', 'commit', 'reset']);
  assert.deepEqual(committed, [result]);
  assert.equal(committed[0], result);
  assert.equal(form, undefined);
});

test('PF02 same-tick submissions evaluate once and a later submission can acquire the released request', async () => {
  const lease = createPanelFormLease();
  const query = deferred<string>();
  const committed: string[] = [];
  let evaluations = 0, resets = 0;
  const submit = () => lease.submit({
    isMounted: () => true,
    evaluate: () => { evaluations++; return query.promise; },
    commit: value => committed.push(value),
    reset: () => { resets++; },
  });
  const first = submit();
  const duplicate = submit();
  assert.equal(evaluations, 1);
  assert.equal(await duplicate, false);
  query.resolve('completed A');
  assert.equal(await first, true);
  assert.deepEqual(committed, ['completed A']);
  assert.equal(resets, 1);
  assert.equal(await lease.submit({
    isMounted: () => true,
    evaluate: async () => { evaluations++; return 'completed B'; },
    commit: value => committed.push(value),
    reset: () => { resets++; },
  }), true);
  assert.equal(evaluations, 2);
  assert.deepEqual(committed, ['completed A', 'completed B']);
  assert.equal(resets, 2);
});

test('PF03 closing A and opening a new panel B retains B while the valid A result still commits', async () => {
  const lease = createPanelFormLease();
  const query = deferred<{ panelId: string; value: number }>();
  const panels: Array<{ panelId: string; value: number }> = [];
  let form: { kind: string; draft: ReturnType<typeof panelDraft> } | undefined = { kind: 'panel', draft: panelDraft() };
  const pending = lease.submit({
    isMounted: () => true, evaluate: () => query.promise,
    commit: value => panels.push(value),
    reset: () => { form = undefined; },
  });
  lease.invalidate();
  form = undefined;
  lease.invalidate();
  const successor = { kind: 'panel', draft: { ...panelDraft(), title: 'New panel B', sql: 'SELECT count(*) FROM customers' } };
  form = successor;
  const result = { panelId: 'submitted-A', value: 7 };
  query.resolve(result);
  assert.equal(await pending, true);
  assert.deepEqual(panels, [result]);
  assert.equal(form, successor);
  assert.equal(form.draft.title, 'New panel B');
});

test('PF04 each in-place panel draft edit preserves the newer draft without discarding the submitted result', async () => {
  const edits: Array<Partial<ReturnType<typeof panelDraft>>> = [
    { title: 'Edited title' }, { sql: 'SELECT amount FROM sales WHERE amount > 0' },
    { type: 'metric' }, { datasetIds: ['customers', 'sales'] },
  ];
  for (const edit of edits) {
    const lease = createPanelFormLease(), query = deferred<string>();
    const submitted = panelDraft();
    let form = submitted, evaluatedDraft: typeof submitted | undefined;
    const committed: string[] = [];
    let resets = 0;
    const pending = lease.submit({
      isMounted: () => true,
      evaluate: () => { evaluatedDraft = submitted; return query.promise; },
      commit: value => committed.push(value), reset: () => { resets++; form = panelDraft(); },
    });
    lease.invalidate();
    const edited = { ...submitted, ...edit };
    form = edited;
    query.resolve('result of submitted A');
    assert.equal(await pending, true);
    assert.equal(evaluatedDraft, submitted);
    assert.deepEqual(submitted, panelDraft());
    assert.deepEqual(committed, ['result of submitted A']);
    assert.equal(form, edited);
    assert.equal(resets, 0);
  }
});

test('PF05 replacing a pending panel form with another dialog or inspector never resets its successor', async () => {
  for (const kind of ['new-view', 'sources', 'settings', 'metrics', 'inspector']) {
    const lease = createPanelFormLease(), query = deferred<string>();
    let surface: { kind: string; name: string; inspectedPanelId?: string } | undefined = { kind: 'panel', name: 'Panel A' };
    const committed: string[] = [];
    const pending = lease.submit({
      isMounted: () => true, evaluate: () => query.promise,
      commit: value => committed.push(value), reset: () => { surface = undefined; },
    });
    lease.invalidate();
    const successor = { kind, name: 'Retained successor draft', ...(kind === 'inspector' ? { inspectedPanelId: 'existing-panel' } : {}) };
    surface = successor;
    query.resolve('completed panel A');
    assert.equal(await pending, true);
    assert.deepEqual(committed, ['completed panel A']);
    assert.equal(surface, successor);
  }
});

test('PF06 a view and form ABA transition cannot restore the old form reset authority', async () => {
  const lease = createPanelFormLease(), query = deferred<string>();
  let activeView = 'view-A';
  const original = { viewId: 'view-A', ...panelDraft() };
  let form: typeof original | undefined = original;
  const destinations = new Map<string, string[]>([['view-A', []], ['view-B', []]]);
  const destination = activeView;
  const pending = lease.submit({
    isMounted: () => true, evaluate: () => query.promise,
    commit: value => destinations.get(destination)!.push(value),
    reset: () => { form = undefined; },
  });
  lease.invalidate();
  activeView = 'view-B';
  form = { viewId: activeView, ...panelDraft(), title: 'Panel in B' };
  lease.invalidate();
  activeView = 'view-A';
  const reopened = { viewId: activeView, ...panelDraft() };
  form = reopened;
  assert.deepEqual(reopened, original);
  assert.notEqual(reopened, original);
  query.resolve('completed for original view A');
  assert.equal(await pending, true);
  assert.deepEqual(destinations.get('view-A'), ['completed for original view A']);
  assert.deepEqual(destinations.get('view-B'), []);
  assert.equal(form, reopened);
});

test('PF07 unmount and remount fence old callbacks and old settlement cannot release the new request', async () => {
  const lease = createPanelFormLease(), oldQuery = deferred<string>(), newQuery = deferred<string>();
  let mounted = true;
  const committed: string[] = [], reset: string[] = [];
  const old = lease.submit({ isMounted: () => mounted, evaluate: () => oldQuery.promise,
    commit: value => committed.push(value), reset: () => reset.push('old') });
  mounted = false;
  lease.dispose();
  assert.equal(await lease.submit({ isMounted: () => mounted,
    evaluate: () => { throw new Error('unmounted work must not start'); },
    commit: () => assert.fail('unmounted work committed'), reset: () => assert.fail('unmounted form reset') }), false);
  mounted = true;
  const current = lease.submit({ isMounted: () => mounted, evaluate: () => newQuery.promise,
    commit: value => committed.push(value), reset: () => reset.push('current') });
  oldQuery.resolve('old lifetime result');
  assert.equal(await old, false);
  assert.deepEqual(committed, []);
  assert.deepEqual(reset, []);
  assert.equal(await lease.submit({ isMounted: () => mounted,
    evaluate: () => { throw new Error('new request must still own submission'); },
    commit: () => assert.fail('duplicate committed'), reset: () => assert.fail('duplicate reset') }), false);
  newQuery.resolve('new lifetime result');
  assert.equal(await current, true);
  assert.deepEqual(committed, ['new lifetime result']);
  assert.deepEqual(reset, ['current']);
});

test('PF08 an evaluation rejection preserves the draft and releases the request for a real retry', async () => {
  const lease = createPanelFormLease(), failedQuery = deferred<string>(), retryQuery = deferred<string>();
  const original = panelDraft();
  let form: typeof original | undefined = original;
  const committed: string[] = [];
  let resets = 0;
  const failed = lease.submit({ isMounted: () => true, evaluate: () => failedQuery.promise,
    commit: value => committed.push(value), reset: () => { resets++; form = undefined; } });
  const rejected = assert.rejects(failed, { message: 'authored evaluation rejection' });
  failedQuery.reject(new Error('authored evaluation rejection'));
  await rejected;
  assert.equal(form, original);
  assert.deepEqual(committed, [] as string[]);
  assert.equal(resets, 0);
  const retry = lease.submit({ isMounted: () => true, evaluate: () => retryQuery.promise,
    commit: value => committed.push(value), reset: () => { resets++; form = undefined; } });
  retryQuery.resolve('completed retry');
  assert.equal(await retry, true);
  assert.deepEqual(committed, ['completed retry']);
  assert.equal(resets, 1);
  assert.equal(form, undefined);
});
