import { ctx } from './ctx';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const $ = (sel: string, root: any = document) => root.querySelector(sel);
export const $$ = (sel: string, root: any = document) =>
  Array.from(root.querySelectorAll(sel));

export async function waitFor(sel: string, opts: any = {}) {
  const { timeout = 5000, interval = 100, root = document } = opts;
  const start = Date.now();
  for (;;) {
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
    try {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url,
        ...opts,
        onload: (r: any) => resolve(r),
        onerror: (e: any) => reject(new Error('gmFetch error: ' + (e && e.error))),
        ontimeout: () => reject(new Error('gmFetch timeout: ' + url)),
      });
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

// `print` GLOBAL & STABIL: selalu menulis ke run yang sedang aktif (top of stack).
// Penting supaya fungsi yang disimpan di `lib` (didefinisikan di cell setup) tetap
// mengarah ke output cell yang memanggilnya, bukan ke run tempat ia didefinisikan.
export const printStack: Array<(line: string) => void> = [];
export function print(...a: any[]) {
  const line = a.map(fmt).join(' ');
  const sink = printStack[printStack.length - 1];
  if (sink) sink(line);
  else console.log('[nb]', line); // dipanggil di luar run (mis. dari DevTools)
}

// Ekspor helper ke window juga -> bisa dipakai dari DevTools console saat eksplorasi manual.
try {
  const w = window as any;
  w.$ = $;
  w.$$ = $$;
  w.sleep = sleep;
  w.waitFor = waitFor;
  w.gmFetch = gmFetch;
  w.nbCtx = ctx;
} catch (_) {
  /* beberapa halaman freeze window; abaikan */
}
