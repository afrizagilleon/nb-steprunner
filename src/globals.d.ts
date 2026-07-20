// Tampermonkey globals. (preact/htm/CodeMirror are bundled, not globals.)
export {};

declare global {
  const GM_getValue: (key: string, def?: any) => any;
  const GM_setValue: (key: string, val: any) => any;
  const GM_deleteValue: (key: string) => any;
  const GM_xmlhttpRequest: (opts: any) => any;
  // Not implemented by every manager — always feature-detect before calling.
  const GM_listValues: (() => string[]) | undefined;
  const GM_addValueChangeListener:
    | ((key: string, cb: (key: string, oldVal: any, newVal: any, remote: boolean) => void) => any)
    | undefined;
  const GM_removeValueChangeListener: ((id: any) => void) | undefined;

  interface Window {
    $?: any;
    $$?: any;
    sleep?: any;
    waitFor?: any;
    gmFetch?: any;
    nbCtx?: any;
  }
}
