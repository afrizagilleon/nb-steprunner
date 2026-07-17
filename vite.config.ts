import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Bundler khusus userscript. preact/hooks/htm tetap dari CDN via @require
// (bukan di-bundle) — perilaku identik dengan versi single-file v0.6.
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'nb-steprunner',
        namespace: 'https://github.com/afriza/nb-steprunner',
        version: '0.6.0',
        author: 'Afriza',
        description:
          'Notebook-style step runner di dalam page: cell independen (blob-module), ctx bersama, resume/checkpoint, Run All/loop, import/export. Editor cell di panel.',
        match: ['https://GANTI-SITUS-TARGET-ANDA/*'],
        noframes: true,
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_deleteValue',
          'GM_xmlhttpRequest',
        ],
        require: [
          'https://cdn.jsdelivr.net/npm/preact@10.23.1/dist/preact.umd.js',
          'https://cdn.jsdelivr.net/npm/preact@10.23.1/hooks/dist/hooks.umd.js',
          'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js',
        ],
        'run-at': 'document-idle',
      },
      build: {
        fileName: 'nb-steprunner.user.js',
      },
    }),
  ],
});
