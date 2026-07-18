import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Userscript-specific bundler. preact/hooks/htm stay on the CDN via @require
// (not bundled) — behavior identical to the single-file v0.6.
export default defineConfig({
  // Minify the bundle — CodeMirror makes the unminified output large (~1MB).
  build: { minify: 'esbuild' },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'nb-steprunner',
        namespace: 'https://github.com/afrizagilleon/nb-steprunner',
        version: '0.7.0',
        author: 'Afriza',
        homepage: 'https://github.com/afrizagilleon/nb-steprunner',
        // Auto-update: Tampermonkey checks these. jsDelivr default-branch = latest build.
        updateURL:
          'https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js',
        downloadURL:
          'https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js',
        description:
          'Notebook-style step runner inside the page: independent cells (blob-module), shared ctx, resume/checkpoint, Run All/loop, import/export. Cell editor in a panel.',
        match: ['https://YOUR-TARGET-SITE/*'],
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
