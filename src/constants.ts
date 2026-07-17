export const SCHEMA = 'nb:v1';

export const VALID_KINDS = ['step', 'setup', 'probe'];

export const DEFAULT_SOURCE: Record<string, string> = {
  step: "// cell baru\nprint('halaman:', document.title);\n",
  probe:
    "// probe: bangun handle ke ctx.refs, jalankan berulang\n// ctx.refs.editor = $('.monaco-editor');\n",
  setup:
    "// setup: dijalankan otomatis saat load (& setelah reload).\n// Taruh fungsi reusable di lib -> dipakai cell lain lewat lib.namaFn().\nlib.hello = () => print('hai dari lib');\n",
};

// Header yang disuntik otomatis -> cell bisa langsung pakai `$`, `ctx`, dst
// tanpa prefix `api.` (tetap tersedia lewat `api` bila diperlukan).
export const CELL_HEADER =
  'const { ctx, lib, $, $$, sleep, gmFetch, waitFor, print } = api;\n';
