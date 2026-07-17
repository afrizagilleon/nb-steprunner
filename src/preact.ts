// Akses preact/hooks/htm dari global CDN (@require). Tidak di-bundle.
const p = (window as any).preact;
const hooks = (window as any).preactHooks;

export const h = p.h;
export const render = p.render;
export const html = (window as any).htm.bind(p.h);

export const useState = hooks.useState;
export const useEffect = hooks.useEffect;
export const useRef = hooks.useRef;
export const useCallback = hooks.useCallback;
