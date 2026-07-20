// Cross-tab, cross-host shared state.
//
// GM storage belongs to the USERSCRIPT, not to a page — so every tab running this script
// reads and writes the same store, whatever site it is on. That is what makes handing data
// from a tab on site A to a tab on site B possible at all.
//
// Design notes:
//   * Each key is its own GM entry, so two tabs writing different keys never clobber each
//     other (a single shared object would be read-modify-write and lose updates).
//   * Writes also bump one SIGNAL entry. GM_addValueChangeListener only watches a specific
//     name, so this single channel is what lets onChange() see keys it has never seen.
//   * Every value records which host wrote it and when — cross-site state is worth auditing.

import { SCHEMA } from './constants';
import { host, gmGet, gmSet } from './storage';
import { sleep } from './helpers';

const DATA = `${SCHEMA}:shared:d:`;
const SIGNAL = `${SCHEMA}:shared:__signal`;

export type SharedMeta = { host: string; at: number };
type Envelope = { v: any; host: string; at: number };
type ChangeInfo = { action: 'set' | 'delete'; from: string; remote: boolean };

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    '[nb] ctx.shared is shared across ALL sites this userscript matches, and is stored ' +
      'unencrypted by the userscript manager. Do not put credentials or tokens in it ' +
      'unless you trust every matched site and every notebook you run.'
  );
}

type Sub = (key: string, value: any, info: ChangeInfo) => void;
// Each subscription remembers which cell registered it. Cells re-run (manually and, more
// often, inside the Run All loop), and a persistent subscription that re-registers every
// run would pile up — one set() would then fire the handler dozens of times. Tagging the
// owner lets us drop a cell's previous subscriptions before it runs again (see
// beginCellScope), so a cell always ends with exactly its latest handler.
const subs = new Map<Sub, string | null>();
let currentOwner: string | null = null;
let listenerId: any = null;

// Called by the kernel before a cell runs: forget subscriptions this cell left behind on a
// previous run, and tag subscriptions made during this run as belonging to it.
export function beginCellScope(cellId: string | null) {
  currentOwner = cellId;
  if (cellId == null) return;
  for (const [cb, owner] of subs) if (owner === cellId) subs.delete(cb);
}
export function endCellScope() {
  currentOwner = null;
}

function ensureListener() {
  if (listenerId != null || typeof GM_addValueChangeListener !== 'function') return;
  listenerId = GM_addValueChangeListener(
    SIGNAL,
    (_name: string, _old: any, nv: any, remote: boolean) => {
      if (!nv || !nv.key) return;
      const deliver = (value: any) => {
        for (const cb of subs.keys()) {
          try {
            cb(nv.key, value, { action: nv.action, from: nv.host, remote });
          } catch (e) {
            console.error('[nb] shared.onChange handler failed:', e);
          }
        }
      };
      if (nv.action === 'delete') deliver(undefined);
      else shared.get(nv.key).then(deliver);
    }
  );
}

async function signal(key: string, action: 'set' | 'delete') {
  // `n` guarantees the entry actually changes, so the listener always fires.
  await gmSet(SIGNAL, { key, action, host, at: Date.now(), n: Math.random() });
}

export const shared = {
  /** True when the manager can push live cross-tab change events. */
  get live() {
    return typeof GM_addValueChangeListener === 'function';
  },

  async get(key: string, def?: any) {
    const env: Envelope | null = await gmGet(DATA + key, null);
    return env && typeof env === 'object' && 'v' in env ? env.v : def;
  },

  /** Who wrote this key and when — `null` if the key is unset. */
  async meta(key: string): Promise<SharedMeta | null> {
    const env: Envelope | null = await gmGet(DATA + key, null);
    return env ? { host: env.host, at: env.at } : null;
  },

  async set(key: string, value: any) {
    warnOnce();
    await gmSet(DATA + key, { v: value, host, at: Date.now() } as Envelope);
    await signal(key, 'set');
    return value;
  },

  async delete(key: string) {
    await GM_deleteValue(DATA + key);
    await signal(key, 'delete');
  },

  async keys(): Promise<string[]> {
    if (typeof GM_listValues !== 'function') {
      throw new Error(
        'shared.keys() needs `// @grant GM_listValues` in the userscript header'
      );
    }
    return GM_listValues()
      .filter((k) => k.startsWith(DATA))
      .map((k) => k.slice(DATA.length));
  },

  /** Every shared key with its value and provenance. */
  async all(): Promise<Record<string, { value: any; host: string; at: number }>> {
    const out: Record<string, any> = {};
    for (const k of await this.keys()) {
      const env: Envelope | null = await gmGet(DATA + k, null);
      if (env) out[k] = { value: env.v, host: env.host, at: env.at };
    }
    return out;
  },

  async clear() {
    for (const k of await this.keys()) await GM_deleteValue(DATA + k);
    await signal('*', 'delete');
  },

  /**
   * Wait until a key is set (by this tab or any other) and return its value.
   * Polls, so it works on managers without change events — and honours Stop,
   * because it uses the run's abortable sleep.
   */
  async wait(key: string, opts: any = {}) {
    const { timeout = 60000, interval = 300 } = opts;
    const start = Date.now();
    for (;;) {
      const v = await this.get(key, undefined);
      if (v !== undefined) return v;
      if (Date.now() - start > timeout) {
        throw new Error(`shared.wait timeout (${timeout}ms): ${key}`);
      }
      await sleep(interval);
    }
  },

  /**
   * Subscribe to changes from this tab and others. Returns an unsubscribe function.
   * `info.remote` is true when the write came from a different tab.
   */
  onChange(cb: Sub) {
    ensureListener();
    subs.set(cb, currentOwner);
    return () => subs.delete(cb);
  },
};
