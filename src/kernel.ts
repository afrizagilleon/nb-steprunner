import { ctx } from './ctx';
import { $, $$, sleep, gmFetch, waitFor, print, fmt, printStack } from './helpers';
import { checkpoint } from './checkpoint';
import { CELL_HEADER } from './constants';
import type { Cell, RunResult } from './types';

// CSP situs target memblok eval/new Function -> eksekusi WAJIB via blob-module import.
export async function compile(cell: Cell) {
  const moduleCode =
    `export default async (api) => {\n${CELL_HEADER}${cell.source}\n};\n` +
    `//# sourceURL=nb-cell-${cell.name || cell.id}.js`;
  const url = URL.createObjectURL(
    new Blob([moduleCode], { type: 'text/javascript' })
  );
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// runCell menjalankan satu cell.
export async function runCell(cell: Cell): Promise<RunResult> {
  const out: string[] = [];
  printStack.push((line) => out.push(line));
  const api = { ctx, lib: ctx.lib, $, $$, sleep, gmFetch, waitFor, print };
  try {
    const fn = await compile(cell);
    const result = await fn(api);
    if (result !== undefined) out.push(fmt(result));
    const text = out.join('\n');
    // Hanya cell 'step' yang menggeser titik resume + snapshot progres.
    // 'setup'/'probe' bukan langkah alur, jadi tak mengubah checkpoint.
    if (cell.kind === 'step') await checkpoint.markSuccess(cell.id);
    return { ok: true, result, output: text };
  } catch (err: any) {
    const text =
      out.join('\n') +
      (out.length ? '\n' : '') +
      '✖ ' +
      String(err && err.stack ? err.stack : err);
    return { ok: false, error: err, output: text };
  } finally {
    printStack.pop();
  }
}
