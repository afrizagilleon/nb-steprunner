import { ctx } from './ctx';
import { $, $$, sleep, gmFetch, waitFor, print, fmt, printStack, signalStack } from './helpers';
import { checkpoint } from './checkpoint';
import { CELL_HEADER } from './constants';
import { compileModule } from './compile';
import { frames } from './frames';
import type { Cell, RunResult } from './types';

export function compile(cell: Cell) {
  return compileModule(cell.source, CELL_HEADER, `nb-cell-${cell.name || cell.id}`);
}

// compile() wraps the cell source in 2 lines before the user's code (the `async (api) =>`
// line and the injected CELL_HEADER), so a stack line points 2 higher than the real one.
const HEADER_LINES = 2;

// Rewrite `nb-cell-*.js:LINE:COL` / `nb-frame-*.js:LINE:COL` back to the line the user wrote.
function remapLines(text: string): string {
  return text.replace(
    /(nb-(?:cell|frame)[^\s:)]*\.js):(\d+):(\d+)/g,
    (_m, file, line, col) => `${file}:${Math.max(1, Number(line) - HEADER_LINES)}:${col}`
  );
}

function formatError(err: any): string {
  if (err && err.stack) return '✖ ' + remapLines(String(err.stack));
  const name = (err && err.name) || 'Error';
  const msg = err && err.message != null ? err.message : String(err);
  return `✖ ${name}: ${msg}`;
}

// runCell executes a single cell. `signal` lets a run be aborted (Stop); when it fires,
// the injected `sleep`/`waitFor`/`gmFetch` reject with AbortError.
export async function runCell(cell: Cell, signal?: AbortSignal): Promise<RunResult> {
  const out: string[] = [];
  printStack.push((line) => out.push(line));
  signalStack.push(signal);
  const api = { ctx, lib: ctx.lib, $, $$, sleep, gmFetch, waitFor, print, frames, signal };
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
    return { ok: false, error: err, output: tail(formatError(err)) };
  } finally {
    printStack.pop();
    signalStack.pop();
  }
}
