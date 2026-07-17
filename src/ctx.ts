import type { Ctx } from './types';

// ctx.data -> serializable, disnapshot ke checkpoint & di-restore saat reload
// ctx.refs -> ephemeral (DOM node, instance editor), TIDAK dipersist
// ctx.lib  -> ephemeral, rumah baku untuk FUNGSI reusable (diisi via cell 'setup')
export const ctx: Ctx = { data: {}, refs: {}, lib: {} };
