import { mkdir, copyFile } from 'node:fs/promises';
const files = ['duckdb-mvp.wasm', 'duckdb-browser-mvp.worker.js'];
await mkdir('public/duckdb', { recursive: true });
for (const file of files) await copyFile(`node_modules/@duckdb/duckdb-wasm/dist/${file}`, `public/duckdb/${file}`);
