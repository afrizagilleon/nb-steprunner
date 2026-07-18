// Layout guards: keep the panel and the minimized button reachable.
//
// Without clamping, a drag can throw the panel past the viewport edge — and because the
// position is persisted to GM storage, it stays unreachable across reloads. Every place
// that writes a position runs it through these helpers first.

export type PanelPos = { x: number; y: number; w: number; h: number; listW: number; outH: number };
export type MiniPos = { x: number; y: number };

/** How much of the panel must stay on screen horizontally. */
const MIN_VISIBLE_X = 120;
/** Header height — kept fully on screen so the panel can always be dragged back. */
const HEADER_H = 34;
const MIN_W = 300;
const MIN_H = 240;
const MINI_SIZE = 38;

export const DEFAULT_PANEL: PanelPos = { x: 20, y: 20, w: 420, h: 480, listW: 130, outH: 130 };
export const DEFAULT_MINI: MiniPos = { x: 20, y: 80 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const num = (v: any, def: number) => (Number.isFinite(Number(v)) ? Number(v) : def);

export const viewport = () => ({
  vw: window.innerWidth || document.documentElement.clientWidth || 0,
  vh: window.innerHeight || document.documentElement.clientHeight || 0,
});

/**
 * Constrain a panel position/size to the current viewport.
 * The header stays fully visible vertically and at least MIN_VISIBLE_X px horizontally,
 * so the panel can never end up in a corner with no grab area left.
 */
export function clampPanel(p: Partial<PanelPos>, vw?: number, vh?: number): PanelPos {
  const vp = viewport();
  const W = vw ?? vp.vw;
  const H = vh ?? vp.vh;

  const w = clamp(num(p.w, DEFAULT_PANEL.w), MIN_W, Math.max(MIN_W, W));
  const h = clamp(num(p.h, DEFAULT_PANEL.h), MIN_H, Math.max(MIN_H, H));
  const x = clamp(num(p.x, DEFAULT_PANEL.x), MIN_VISIBLE_X - w, Math.max(0, W - MIN_VISIBLE_X));
  const y = clamp(num(p.y, DEFAULT_PANEL.y), 0, Math.max(0, H - HEADER_H));

  // Splitters are relative to the panel box, so they depend on the clamped w/h.
  const listW = clamp(num(p.listW, DEFAULT_PANEL.listW), 90, Math.max(90, w - 140));
  const outH = clamp(num(p.outH, DEFAULT_PANEL.outH), 36, Math.max(36, h - 180));

  return { x, y, w, h, listW, outH };
}

/** Constrain the minimized button so it always stays fully on screen. */
export function clampMini(m: Partial<MiniPos>, vw?: number, vh?: number): MiniPos {
  const vp = viewport();
  const W = vw ?? vp.vw;
  const H = vh ?? vp.vh;
  return {
    x: clamp(num(m.x, DEFAULT_MINI.x), 0, Math.max(0, W - MINI_SIZE)),
    y: clamp(num(m.y, DEFAULT_MINI.y), 0, Math.max(0, H - MINI_SIZE)),
  };
}
