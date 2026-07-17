import { SCHEMA } from './constants';
import { normalizeCell } from './io';
import type { Notebook, Checkpoint } from './types';

export const host = location.host;
export const hostKey = (suffix: string) => `${SCHEMA}:${host}:${suffix}`;
export const globalKey = (suffix: string) => `${SCHEMA}:${suffix}`;

// Bungkus GM get/set supaya aman untuk varian sinkron (GM_) maupun promise (GM.).
export const gmGet = async (key: string, def?: any) => await GM_getValue(key, def);
export const gmSet = async (key: string, val: any) => await GM_setValue(key, val);

export const KEY_NOTEBOOK = () => hostKey('notebook');
export const KEY_CHECKPOINT = () => hostKey('checkpoint');
export const KEY_PANELPOS = globalKey('panelPos');
export const KEY_MINIPOS = globalKey('miniPos');

export const emptyNotebook = (): Notebook => ({ version: 1, cells: [] });

export async function loadNotebook(): Promise<Notebook> {
  const nb = await gmGet(KEY_NOTEBOOK(), null);
  if (!nb || !Array.isArray(nb.cells)) return emptyNotebook();
  return { version: 1, cells: nb.cells.map(normalizeCell) };
}
export async function saveNotebook(nb: Notebook) {
  await gmSet(KEY_NOTEBOOK(), nb);
}
export async function loadCheckpoint(): Promise<Checkpoint | null> {
  return await gmGet(KEY_CHECKPOINT(), null);
}
export async function saveCheckpoint(cp: Checkpoint | null) {
  await gmSet(KEY_CHECKPOINT(), cp);
}
