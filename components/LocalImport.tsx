'use client';

import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen, LoaderCircle, Square } from 'lucide-react';
import { importFile, listWorkbookSheets } from '@/lib/engine';
import { planLocalFiles, validateImportSelection, type ImportCandidate } from '@/lib/local-import';
import type { Dataset } from '@/lib/types';

type Outcome = { status: 'importing' | 'ready' | 'error' | 'cancelled'; message: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function LocalImport({ disabled, onBegin, onEnd, onImported }: {
  disabled: boolean;
  onBegin: (controller: AbortController) => void;
  onEnd: (controller: AbortController) => void;
  onImported: (dataset: Dataset) => void;
}) {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheets, setSheets] = useState<Record<string, string[]>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [inspecting, setInspecting] = useState('');
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    folderInput.current?.setAttribute('webkitdirectory', '');
    return () => { mounted.current = false; generation.current++; operation.current?.abort(); };
  }, []);

  function choose(files: FileList | null, folder: boolean) {
    if (operation.current) return;
    generation.current++;
    setSelected([]); setSheets({}); setChoices({}); setOutcomes({}); setNotice('');
    try { setCandidates(planLocalFiles(files ?? [], folder)); }
    catch (error) { setCandidates([]); setNotice(message(error)); }
  }
  async function inspect(candidate: ImportCandidate) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const current = generation.current;
    setInspecting(candidate.id); setNotice('');
    try {
      const names = await listWorkbookSheets(candidate.file, controller.signal);
      if (!mounted.current || generation.current !== current) return;
      if (!names.length) throw new Error('This workbook has no sheets.');
      setSheets(value => ({ ...value, [candidate.id]: names }));
      setChoices(value => ({ ...value, [candidate.id]: names[0] }));
    } catch (error) {
      if (mounted.current && generation.current === current) setNotice(message(error));
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setInspecting('');
    }
  }
  const pending = selected.filter(id => outcomes[id]?.status !== 'ready');
  const selectionError = validateImportSelection(candidates, pending);
  const uninspected = candidates.some(candidate => pending.includes(candidate.id) && /\.xlsx$/i.test(candidate.file.name) && !choices[candidate.id]);
  async function run() {
    if (disabled || operation.current || selectionError || uninspected) return;
    const controller = new AbortController(); operation.current = controller;
    setWorking(true); setNotice('');
    onBegin(controller);
    let imported = 0;
    let failed = 0;
    try {
      for (const id of pending) {
        if (controller.signal.aborted) break;
        const candidate = candidates.find(value => value.id === id)!;
        if (mounted.current) setOutcomes(value => ({ ...value, [id]: { status: 'importing', message: 'Importing on this device…' } }));
        try {
          const dataset = await importFile(candidate.file, choices[id], controller.signal, candidate.path);
          // A committed file remains part of the workspace even if this dialog closed.
          onImported(dataset); imported++;
          if (mounted.current) setOutcomes(value => ({ ...value, [id]: { status: 'ready', message: `Ready · ${dataset.rowCount.toLocaleString()} rows` } }));
        } catch (error) {
          if (controller.signal.aborted) {
            if (mounted.current) setOutcomes(value => ({ ...value, [id]: { status: 'cancelled', message: 'Cancelled · not imported' } }));
            break;
          }
          failed++;
          if (mounted.current) setOutcomes(value => ({ ...value, [id]: { status: 'error', message: message(error) } }));
        }
      }
    } finally {
      operation.current = null; onEnd(controller);
      if (mounted.current) {
        setWorking(false);
        setNotice(`${controller.signal.aborted ? 'Import stopped. ' : ''}${imported} imported, ${failed} failed in this run. Successful files stay on this device. Schema and result sharing are off.`);
      }
    }
  }
  const locked = disabled || working || Boolean(inspecting);
  return <div className="local-import">
    <div className="import-pickers">
      <label className="upload-zone"><FileSpreadsheet size={26} /><strong>Choose files</strong><span>CSV, TSV, JSON, JSONL, NDJSON, XLSX or Parquet</span><input aria-label="Choose data files" type="file" multiple accept=".csv,.tsv,.json,.jsonl,.ndjson,.xlsx,.parquet" disabled={locked} onChange={event => { choose(event.target.files, false); event.target.value = ''; }} /></label>
      <label className="upload-zone"><FolderOpen size={26} /><strong>Choose a folder</strong><span>Preview its files, then choose what to import</span><input ref={folderInput} aria-label="Choose a data folder" type="file" multiple disabled={locked} onChange={event => { choose(event.target.files, true); event.target.value = ''; }} /></label>
    </div>
    <p className="field-help">Files stay on this device. Up to 200 files in a preview, 20 selected files and 100 MB per run; 20 MB per file. Folder access is a one-time snapshot.</p>
    {candidates.length > 0 && <><div className="section-heading"><h3>Choose datasets</h3><span>{pending.length} selected to import</span></div><div className="import-candidates">{candidates.map(candidate => {
      const outcome = outcomes[candidate.id];
      const workbook = /\.xlsx$/i.test(candidate.file.name);
      return <div className={`import-candidate ${candidate.error || outcome?.status === 'error' ? 'import-error' : ''}`} key={candidate.id}>
        <label className="import-file-choice"><input type="checkbox" aria-label={`Select ${candidate.path}`} disabled={locked || Boolean(candidate.error) || outcome?.status === 'ready'} checked={selected.includes(candidate.id)} onChange={event => setSelected(value => event.target.checked ? [...value, candidate.id] : value.filter(id => id !== candidate.id))} /><span><strong>{candidate.path}</strong><small>{size(candidate.file.size)}{candidate.error ? ` · ${candidate.error}` : ''}</small></span></label>
        {!candidate.error && workbook && outcome?.status !== 'ready' && <div className="import-sheet">{sheets[candidate.id] ? <label>Workbook sheet<select className="input" aria-label={`Sheet for ${candidate.path}`} value={choices[candidate.id]} disabled={locked} onChange={event => setChoices(value => ({ ...value, [candidate.id]: event.target.value }))}>{sheets[candidate.id].map(name => <option key={name}>{name}</option>)}</select></label> : <button className="button" disabled={locked} aria-label={`Inspect sheets for ${candidate.path}`} onClick={() => void inspect(candidate)}>{inspecting === candidate.id && <LoaderCircle size={14} className="spin" />}Choose a sheet</button>}</div>}
        {outcome && <p className="import-outcome" role="status">{outcome.message}</p>}
      </div>;
    })}</div><div className="import-actions"><button className="button button-primary" disabled={locked || Boolean(selectionError) || uninspected} onClick={() => void run()}>{working && <LoaderCircle size={15} className="spin" />}Import selected</button>{working && <button className="button" onClick={() => operation.current?.abort()}><Square size={13} />Stop import</button>}<span className="field-help">{pending.length ? selectionError || (uninspected ? 'Choose a sheet for each selected workbook.' : `${size(candidates.filter(candidate => pending.includes(candidate.id)).reduce((total, candidate) => total + candidate.file.size, 0))} selected`) : 'Select the files you want to analyze.'}</span></div></>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}
  </div>;
}
