// Cross-frame access, top-frame side.
//
// An <iframe> is a separate document. Two very different cases:
//
//   same-origin  -> iframe.contentDocument works directly; no messaging needed.
//   cross-origin -> the browser blocks DOM access entirely. The only way in is to have
//                   our own userscript running *inside* that frame (Tampermonkey injects
//                   into every frame whose URL matches, as long as @noframes is absent),
//                   then talk to it over postMessage.
//
// `frames.run()` hides the difference: same-origin executes locally against the frame's
// document, cross-origin ships the code to the agent. Only structured-cloneable values
// cross the boundary — DOM nodes cannot travel, so the model is "run code over there,
// return data", exactly like a notebook cell.

import { compileModule } from './compile';
import { FRAME_HEADER } from './constants';
import { sleep, print } from './helpers';
import { NB_FRAME, isFrameMsg, type FrameRes } from './frame-rpc';

export type FrameInfo = {
  index: number;
  src: string;
  id: string;
  sameOrigin: boolean;
  /** Cross-origin only: whether an agent in that frame has answered us. */
  ready: boolean;
};

/** contentWindows that have announced an agent. */
const agents = new WeakSet<Window>();
/** In-flight RPCs, keyed by request id. */
const pending = new Map<string, { resolve: (r: FrameRes) => void }>();
let seq = 0;

function listen() {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (!isFrameMsg(d)) return;
    if (d.kind === 'hello' || d.kind === 'ping') {
      if (e.source) agents.add(e.source as Window);
      return;
    }
    if (d.kind === 'res') {
      const p = pending.get(d.id);
      if (p) {
        pending.delete(d.id);
        p.resolve(d);
      }
    }
  });
}
listen();

const iframes = (): HTMLIFrameElement[] =>
  Array.from(document.querySelectorAll('iframe'));

function docOf(f: HTMLIFrameElement): Document | null {
  try {
    return f.contentDocument || null;
  } catch {
    return null; // cross-origin
  }
}

/** Accepts an index, a CSS selector for the iframe element, or the element itself. */
function resolveFrame(target: any): HTMLIFrameElement {
  if (target instanceof HTMLIFrameElement) return target;
  if (typeof target === 'number') {
    const f = iframes()[target];
    if (!f) throw new Error(`frames: no iframe at index ${target}`);
    return f;
  }
  if (typeof target === 'string') {
    const f = document.querySelector(target);
    if (!(f instanceof HTMLIFrameElement)) {
      throw new Error(`frames: "${target}" did not match an <iframe>`);
    }
    return f;
  }
  throw new Error('frames: target must be an index, a selector, or an iframe element');
}

/** Turn whatever the caller passed into a module body string. */
function toBody(code: any): string {
  if (typeof code === 'function') {
    // Closures do NOT survive — the function is stringified and re-parsed in the other
    // frame. Anything it needs must come in through `args`.
    return `return await (${code.toString()})(args);`;
  }
  if (typeof code === 'string') return code;
  throw new Error('frames.run: expected a function or a source string');
}

async function runLocal(f: HTMLIFrameElement, doc: Document, code: any, args: any) {
  const win = f.contentWindow;
  const fn = await compileModule(toBody(code), FRAME_HEADER, 'nb-frame-local');
  return await fn({
    doc,
    win,
    args,
    $: (sel: string, root: any = doc) => root.querySelector(sel),
    $$: (sel: string, root: any = doc) => Array.from(root.querySelectorAll(sel)),
    sleep,
    waitFor: async (sel: string, opts: any = {}) => {
      const { timeout = 5000, interval = 100 } = opts;
      const start = Date.now();
      for (;;) {
        const el = doc.querySelector(sel);
        if (el) return el;
        if (Date.now() - start > timeout) {
          throw new Error(`waitFor timeout (${timeout}ms) in frame: ${sel}`);
        }
        await sleep(interval);
      }
    },
    print,
  });
}

async function runRemote(f: HTMLIFrameElement, code: any, args: any, timeout: number) {
  const win = f.contentWindow;
  if (!win) throw new Error('frames.run: iframe has no contentWindow');

  const id = `${Date.now()}-${++seq}`;
  const res = await new Promise<FrameRes | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeout);
    pending.set(id, {
      resolve: (r: FrameRes) => {
        clearTimeout(timer);
        resolve(r);
      },
    });
    win.postMessage(
      { __nb: NB_FRAME, kind: 'req', id, body: toBody(code), args },
      '*'
    );
  });

  if (!res) {
    throw new Error(
      'frames.run: timed out with no reply. The frame has no agent — check that its ' +
        `origin (${f.src || '?'}) is covered by the userscript's @match.`
    );
  }
  // Surface the frame's print() output in the calling cell's output pane.
  for (const line of res.output) print(line);
  if (!res.ok) throw new Error('in frame: ' + res.error);
  return res.value;
}

export const frames = {
  /** Inventory of the iframes in this document. */
  list(): FrameInfo[] {
    return iframes().map((f, index) => ({
      index,
      src: f.src || '(no src)',
      id: f.id || '',
      sameOrigin: !!docOf(f),
      ready: !!(f.contentWindow && agents.has(f.contentWindow)),
    }));
  },

  /** The frame's Document — same-origin only, `null` otherwise. */
  doc(target: any): Document | null {
    return docOf(resolveFrame(target));
  },

  /**
   * Run code inside a frame and return its result.
   *
   * The function is stringified, so it cannot capture variables from the calling cell —
   * pass them via `args` instead. The return value must be structured-cloneable.
   */
  async run(target: any, code: any, args: any = null, opts: any = {}) {
    const f = resolveFrame(target);
    const doc = docOf(f);
    if (doc) return await runLocal(f, doc, code, args);
    return await runRemote(f, code, args, Math.max(1, Number(opts.timeout) || 10000));
  },

  /** Wait until a cross-origin frame's agent is reachable. */
  async ready(target: any, timeout = 10000) {
    const f = resolveFrame(target);
    if (docOf(f)) return true;
    const start = Date.now();
    for (;;) {
      if (f.contentWindow && agents.has(f.contentWindow)) return true;
      if (f.contentWindow) {
        f.contentWindow.postMessage({ __nb: NB_FRAME, kind: 'ping' }, '*');
      }
      if (Date.now() - start > timeout) return false;
      await sleep(200);
    }
  },
};

// Available from the DevTools console too (top frame).
try {
  (window as any).nbFrames = frames;
} catch (_) {
  /* ignore frozen window */
}
