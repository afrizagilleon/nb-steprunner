// Shared blob-module compiler.
//
// The target site's CSP blocks eval/new Function, so every path that turns source text
// into a callable — notebook cells (kernel.ts) and cross-frame RPC (frame-agent.ts) —
// goes through a blob: URL + dynamic import(), which is governed by `script-src blob:`
// instead of `unsafe-eval`.

export async function compileModule(
  body: string,
  header: string,
  name: string
): Promise<(api: any) => Promise<any>> {
  const moduleCode =
    `export default async (api) => {\n${header}${body}\n};\n` + `//# sourceURL=${name}.js`;
  const url = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}
