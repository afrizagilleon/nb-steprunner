export type Kind = 'step' | 'setup' | 'probe';

export interface Cell {
  id: string;
  name: string;
  source: string;
  kind: Kind;
  enabled?: boolean;
}

export interface Notebook {
  version: 1;
  cells: Cell[];
}

export interface Checkpoint {
  lastSuccessCellId: string | null;
  data: Record<string, unknown>;
  savedAt: number;
}

export interface RunResult {
  ok: boolean;
  result?: any;
  error?: any;
  output: string;
}

export interface Ctx {
  data: Record<string, any>;
  refs: Record<string, any>;
  lib: Record<string, any>;
}
