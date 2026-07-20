// NOTE: this module must stay a leaf — do not import ctx here. ctx imports shared, and
// shared imports this file; pulling ctx back in would close the cycle and leave `ctx` in
// its temporal dead zone while this module's top-level code runs.

// Thrown when the active run is stopped. Recognised by name so it survives the blob-module
// boundary (instanceof would not — the class identity differs across realms).
export class AbortError extends Error {
  constructor(msg = 'aborted') {
    super(msg);
    this.name = 'AbortError';
  }
}

// The signal of the currently running cell (top of stack), so `sleep`/`waitFor`/`gmFetch`
// abort automatically without the cell having to thread it through. Stacked like printStack
// because a run can nest (e.g. frames.run executing locally inside another run).
export const signalStack: Array<AbortSignal | undefined> = [];
const currentSignal = () => signalStack[signalStack.length - 1];

export const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new AbortError());
      },
      { once: true }
    );
  });

export const sleep = (ms: number) => abortableSleep(ms, currentSignal());
export const $ = (sel: string, root: any = document) => root.querySelector(sel);
export const $$ = (sel: string, root: any = document) =>
  Array.from(root.querySelectorAll(sel));

export async function waitFor(sel: string, opts: any = {}) {
  const { timeout = 5000, interval = 100, root = document } = opts;
  const start = Date.now();
  for (;;) {
    if (currentSignal()?.aborted) throw new AbortError();
    const el = root.querySelector(sel);
    if (el) return el;
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timeout (${timeout}ms): ${sel}`);
    }
    await sleep(interval);
  }
}

export const gmFetch = (url: string, opts: any = {}) =>
  new Promise((resolve, reject) => {
    const signal = currentSignal();
    if (signal?.aborted) return reject(new AbortError());
    try {
      const req: any = GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url,
        ...opts,
        onload: (r: any) => resolve(r),
        onerror: (e: any) => reject(new Error('gmFetch error: ' + (e && e.error))),
        ontimeout: () => reject(new Error('gmFetch timeout: ' + url)),
      });
      signal?.addEventListener(
        'abort',
        () => {
          try {
            req && req.abort && req.abort();
          } catch (_) {
            /* ignore */
          }
          reject(new AbortError());
        },
        { once: true }
      );
    } catch (e) {
      reject(e);
    }
  });

export function fmt(v: any): string {
  if (typeof v === 'string') return v;
  if (v instanceof Element)
    return `<${v.tagName.toLowerCase()}> ${v.className || ''}`.trim();
  if (v instanceof Node) return `[${v.nodeName}]`;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// `print` is GLOBAL & STABLE: it always writes to the currently active run (top of stack).
// This matters so that functions stored on `lib` (defined in a setup cell) keep writing
// to the output of the cell that calls them, not to the run where they were defined.
export const printStack: Array<(line: string) => void> = [];
export function print(...a: any[]) {
  const line = a.map(fmt).join(' ');
  const sink = printStack[printStack.length - 1];
  if (sink) sink(line);
  else console.log('[nb]', line); // called outside a run (e.g. from DevTools)
}

// Also expose helpers on window -> usable from the DevTools console during manual exploration.
try {
  const w = window as any;
  w.$ = $;
  w.$$ = $$;
  w.sleep = sleep;
  w.waitFor = waitFor;
  w.gmFetch = gmFetch;
} catch (_) {
  /* some pages freeze window; ignore */
}
