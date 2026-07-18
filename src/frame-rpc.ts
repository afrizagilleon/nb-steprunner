// Wire protocol shared by the top frame (frames.ts) and the in-frame agent (frame-agent.ts).

export const NB_FRAME = 'nb:frame:v1';

export type FrameReq = { __nb: typeof NB_FRAME; kind: 'req'; id: string; body: string; args: any };
export type FrameRes = {
  __nb: typeof NB_FRAME;
  kind: 'res';
  id: string;
  ok: boolean;
  value?: any;
  error?: string;
  output: string[];
};
/** Sent by an agent as soon as it loads, and again in reply to a 'ping'. */
export type FrameHello = { __nb: typeof NB_FRAME; kind: 'hello' | 'ping' };

export type FrameMsg = FrameReq | FrameRes | FrameHello;

export const isFrameMsg = (d: any): d is FrameMsg =>
  !!d && typeof d === 'object' && d.__nb === NB_FRAME;

/**
 * postMessage can only carry structured-cloneable values, and throws on anything else
 * (DOM nodes, functions, class instances with methods). Rather than let a cell blow up
 * on the return trip, degrade to a readable placeholder.
 */
export function toTransferable(v: any): any {
  try {
    structuredClone(v);
    return v;
  } catch {
    return { __nbUnserializable: String(v && v.constructor ? v.constructor.name : typeof v) };
  }
}
