import type { Ctx } from './types';
import { shared } from './shared';

// ctx.data   -> serializable, snapshotted to the checkpoint & restored on reload
// ctx.refs   -> ephemeral (DOM nodes, editor instances), NOT persisted
// ctx.lib    -> ephemeral, canonical home for reusable FUNCTIONS (filled by 'setup' cells)
// ctx.shared -> async, persisted in GM storage, visible to every tab AND every matched site
export const ctx: Ctx = { data: {}, refs: {}, lib: {}, shared };

// Exposed for manual exploration from the DevTools console. Lives here rather than in
// helpers.ts so that helpers stays a leaf module (see the note there).
try {
  (window as any).nbCtx = ctx;
} catch (_) {
  /* some pages freeze window; ignore */
}
