import type { Panel } from './types.ts';

function sameQuery(left: Panel, right: Panel): boolean {
  return left.id === right.id && left.sql === right.sql
    && left.datasetIds.length === right.datasetIds.length
    && left.datasetIds.every((id, index) => id === right.datasetIds[index]);
}

/** Query completion owns execution fields; the current panel owns its presentation. */
export function applyPanelResults(current: readonly Panel[], completed: readonly Panel[], requested: readonly Panel[] = []): Panel[] {
  return current.map(panel => {
    const completion = completed.find(candidate => sameQuery(panel, candidate));
    if (completion) return { ...panel, result: completion.result, error: completion.error };
    if (requested.some(candidate => sameQuery(panel, candidate))) {
      return { ...panel, result: undefined, error: 'Query not run. Refresh this view to continue.' };
    }
    return panel;
  });
}
