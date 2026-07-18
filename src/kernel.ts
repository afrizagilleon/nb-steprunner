import { ctx } from './ctx';
import { $, $$, sleep, gmFetch, waitFor, print, fmt, printStack } from './helpers';
import { checkpoint } from './checkpoint';
import { CELL_HEADER } from './constants';
import { compileModule } from './compile';
import { frames } from './frames';
import type { Cell, RunResult } from './types';

export function compile(cell: Cell) {
  return compileModule(cell.source, CELL_HEADER, `nb-cell-${cell.name || cell.id}`);
}

// runCell executes a single cell.
export async function runCell(cell: Cell): Promise<RunResult> {
  const out: string[] = [];
  printStack.push((line) => out.push(line));
  const api = { ctx, lib: ctx.lib, $, $$, sleep, gmFetch, waitFor, print, frames };
  try {
    const fn = await compile(cell);
    const result = await fn(api);
    if (result !== undefined) out.push(fmt(result));
    const text = out.join('\n');
    // Only 'step' cells advance the resume point + snapshot progress.
    // 'setup'/'probe' are not flow steps, so they do not touch the checkpoint.
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
