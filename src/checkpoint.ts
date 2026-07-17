import { ctx } from './ctx';
import { loadCheckpoint, saveCheckpoint } from './storage';

// Snapshot hanya ctx.data yang serializable. Node DOM ada di ctx.refs -> tak ikut.
export function safeSnapshot(data: Record<string, any>) {
  try {
    return structuredClone(data);
  } catch (_) {
    // fallback: buang field yang tak bisa diserialisasi, jangan gagal total
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        console.warn(`[nb] skip ctx.data.${k} (non-serializable)`);
      }
    }
    return out;
  }
}

export const checkpoint = {
  lastSuccessCellId: null as string | null,
  async markSuccess(cellId: string) {
    this.lastSuccessCellId = cellId;
    await saveCheckpoint({
      lastSuccessCellId: cellId,
      data: safeSnapshot(ctx.data),
      savedAt: Date.now(),
    });
  },
  // Dipanggil sekali saat bootstrap: pulihkan ctx.data dari checkpoint.
  async restore() {
    const cp = await loadCheckpoint();
    if (!cp) return null;
    if (cp.data && typeof cp.data === 'object') {
      Object.assign(ctx.data, cp.data);
    }
    this.lastSuccessCellId = cp.lastSuccessCellId || null;
    return cp;
  },
  async clear() {
    this.lastSuccessCellId = null;
    await saveCheckpoint(null);
  },
};
