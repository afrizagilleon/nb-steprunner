export const SCHEMA = 'nb:v1';

export const VALID_KINDS = ['step', 'setup', 'probe'];

export const DEFAULT_SOURCE: Record<string, string> = {
  step: "// new cell\nprint('page:', document.title);\n",
  probe:
    "// probe: build a handle into ctx.refs, run repeatedly\n// ctx.refs.editor = $('.monaco-editor');\n",
  setup:
    "// setup: runs automatically on load (and after reload).\n// Put reusable functions on lib -> call them from other cells via lib.fnName().\nlib.hello = () => print('hi from lib');\n",
};

// Header injected automatically -> a cell can use `$`, `ctx`, etc. directly
// without the `api.` prefix (still available via `api` if needed).
export const CELL_HEADER =
  'const { ctx, lib, $, $$, sleep, gmFetch, waitFor, print, frames } = api;\n';

// Header injected into code shipped to another frame. `frames` is deliberately absent:
// a frame agent talks only to the top frame, it does not chain further.
export const FRAME_HEADER =
  'const { doc, win, args, $, $$, sleep, waitFor, print } = api;\n';
