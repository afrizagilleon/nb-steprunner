// Tampermonkey globals + CDN libraries (loaded via @require, not bundled).
export {};

declare global {
  const GM_getValue: (key: string, def?: any) => any;
  const GM_setValue: (key: string, val: any) => any;
  const GM_deleteValue: (key: string) => any;
  const GM_xmlhttpRequest: (opts: any) => any;

  interface Window {
    preact: any;
    preactHooks: any;
    htm: any;
    $?: any;
    $$?: any;
    sleep?: any;
    waitFor?: any;
    gmFetch?: any;
    nbCtx?: any;
  }
}
