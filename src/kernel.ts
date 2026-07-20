import { ctx } from './ctx';
import { $, $$, sleep, gmFetch, waitFor, print, fmt, printStack, signalStack } from './helpers';
import { checkpoint } from './checkpoint';
import { CELL_HEADER } from './constants';
import { compileModule } from './compile';
import { formatError } from './errors';
import { frames } from './frames';
import { beginCellScope, endCellScope } from './shared';
import type { Cell, RunResult } from './types';

export function compile(cell: Cell) {
  return compileModule(cell.source, CELL_HEADER, `nb-cell-${cell.name || cell.id}`);
}

// runCell executes a single cell. `signal` lets a run be aborted (Stop); when it fires,
// the injected `sleep`/`waitFor`/`gmFetch` reject with AbortError.
export async function runCell(cell: Cell, signal?: AbortSignal): Promise<RunResult> {
  const out: string[] = [];
  printStack.push((line) => out.push(line));
  signalStack.push(signal);
  // Drop shared.onChange handlers this cell registered on a previous run, so re-running
  // (especially inside the Run All loop) replaces its subscription instead of stacking.
  beginCellScope(cell.id);
  const api = {
    ctx,
    lib: ctx.lib,
    shared: ctx.shared,
    $,
    $$,
    sleep,
    gmFetch,
    waitFor,
    print,
    frames,
    signal,
  };
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
    const tail = (s: string) => out.join('\n') + (out.length ? '\n' : '') + s;
    if (err && err.name === 'AbortError') {
      return { ok: false, aborted: true, error: err, output: tail('■ stopped') };
    }
    return { ok: false, error: err, output: tail(formatError(err, cell.source)) };
  } finally {
    printStack.pop();
    signalStack.pop();
    endCellScope();
  }
}
