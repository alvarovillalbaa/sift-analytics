import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'next/dist/build/swc/index.js';

export function loadTypescript(path, imports, globals = {}, suffix = '') {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8') + suffix;
  const compiled = transformSync(source, { filename: path, jsc: { parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const exports = {};
  const context = vm.createContext({ exports, module: { exports }, console, Request, Response, Headers, TextDecoder, AbortController, Buffer,
    require(name) { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; },
    ...globals,
  });
  vm.runInContext(compiled, context, { filename: path });
  return exports;
}

export function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
