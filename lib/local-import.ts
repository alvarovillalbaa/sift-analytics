export type ImportCandidate = { id: string; path: string; file: File; error?: string };

const MAX_CANDIDATES = 200;
const MAX_PATH_LENGTH = 4096;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SELECTED_FILES = 20;
const MAX_SELECTED_BYTES = 100 * 1024 * 1024;
const SUPPORTED_FILE = /\.(csv|tsv|json|jsonl|ndjson|xlsx|parquet)$/i;
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;

function fileErrors(file: File): string[] {
  const errors: string[] = [];
  if (!SUPPORTED_FILE.test(file.name)) errors.push('Choose a CSV, TSV, JSON, JSONL, NDJSON, XLSX or Parquet file.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) errors.push('The file must not be empty and must have a valid size.');
  else if (file.size > MAX_FILE_BYTES) errors.push('The file exceeds the 20 MiB limit.');
  return errors;
}

/** Plan metadata only. File contents stay unread until the user imports a selection. */
export function planLocalFiles(files: ArrayLike<File>, folder: boolean): ImportCandidate[] {
  if (files.length > MAX_CANDIDATES) throw new Error('Choose at most 200 files to preview.');

  const rows = Array.from(files).map((file, index) => {
    const rawPath = folder ? file.webkitRelativePath : file.name;
    const path = typeof rawPath === 'string' ? rawPath : '';
    const errors = fileErrors(file);
    const pathTooLong = path.length > MAX_PATH_LENGTH;
    const segments = pathTooLong ? [] : path.split('/');
    const safePath = !pathTooLong && path.length > 0 && !ASCII_CONTROL.test(path) && !path.includes('\\')
      && !/^(\/|[a-z]:)/i.test(path)
      && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
    let root: string | undefined;
    if (pathTooLong) errors.push('The file path exceeds the 4,096-character limit.');
    else if (!safePath) errors.push('Use a relative path without empty, dot, parent, backslash or control-character segments.');
    else if (folder) {
      if (segments.length < 2) errors.push('Folder files need a root folder and a relative file path.');
      else if (segments[segments.length - 1] !== file.name) errors.push('The folder path does not match the file name.');
      else root = segments[0];
    } else if (segments.length !== 1) errors.push('File selection must use a file name without directories.');
    return { path, file, errors, root, index };
  });

  const roots = new Set(rows.flatMap((row) => row.root === undefined ? [] : [row.root]));
  const pathCounts = new Map<string, number>();
  for (const row of rows) pathCounts.set(row.path, (pathCounts.get(row.path) ?? 0) + 1);
  for (const row of rows) {
    if (folder && roots.size > 1 && row.root !== undefined) row.errors.push('Choose files from one common folder root.');
    if ((pathCounts.get(row.path) ?? 0) > 1) row.errors.push('Duplicate paths cannot be imported; choose each exact path only once.');
  }

  rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.index - right.index);
  return rows.map((row, index) => ({
    id: `local-${String(index + 1).padStart(3, '0')}`,
    path: row.path,
    file: row.file,
    ...(row.errors.length ? { error: row.errors.join(' ') } : {}),
  }));
}

export function validateImportSelection(candidates: readonly ImportCandidate[], selectedIds: readonly string[]): string | undefined {
  if (!selectedIds.length) return 'Select at least one valid file to import.';
  if (selectedIds.length > MAX_SELECTED_FILES) return 'Import at most 20 selected files at a time.';
  if (candidates.length > MAX_CANDIDATES) return 'Choose at most 200 files to preview.';

  const byId = new Map<string, ImportCandidate>();
  for (const candidate of candidates) {
    if (typeof candidate.id !== 'string' || !candidate.id || byId.has(candidate.id)) return 'The import list contains invalid or duplicate file IDs. Choose the files again.';
    byId.set(candidate.id, candidate);
  }

  const seen = new Set<string>();
  const paths = new Set<string>();
  let bytes = 0;
  for (const id of selectedIds) {
    if (typeof id !== 'string' || !id || !byId.has(id)) return 'The selection contains a file outside the current import list.';
    if (seen.has(id)) return 'The selection contains a duplicate file ID.';
    seen.add(id);
    const candidate = byId.get(id)!;
    if (candidate.error !== undefined || fileErrors(candidate.file).length) return 'Remove invalid files from the selection before importing.';
    if (paths.has(candidate.path)) return 'The selection contains duplicate file paths.';
    paths.add(candidate.path);
    bytes += candidate.file.size;
    if (bytes > MAX_SELECTED_BYTES) return 'Selected files exceed the 100 MiB import limit.';
  }
  return undefined;
}
