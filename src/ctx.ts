import type { Ctx } from './types';

// ctx.data -> serializable, snapshotted to the checkpoint & restored on reload
// ctx.refs -> ephemeral (DOM nodes, editor instances), NOT persisted
// ctx.lib  -> ephemeral, canonical home for reusable FUNCTIONS (filled by 'setup' cells)
export const ctx: Ctx = { data: {}, refs: {}, lib: {} };
