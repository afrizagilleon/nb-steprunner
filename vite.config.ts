import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// Userscript-specific bundler. Everything (preact, htm, CodeMirror) is bundled so the
// output is a single self-contained file with no load-order or CDN dependencies.
export default defineConfig({
  // Minify the bundle — CodeMirror makes the unminified output large (~1MB).
  build: { minify: 'esbuild' },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'nb-steprunner',
        namespace: 'https://github.com/afrizagilleon/nb-steprunner',
        version: '0.10.0-beta.3',
        author: 'Afriza',
        homepage: 'https://github.com/afrizagilleon/nb-steprunner',
        // Auto-update: Tampermonkey checks these. jsDelivr default-branch = latest build.
        updateURL:
          'https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js',
        downloadURL:
          'https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js',
        description:
          'Notebook-style step runner inside the page: independent cells (blob-module), shared ctx, resume/checkpoint, Run All/loop, import/export. Cell editor in a panel.',
        match: [
          'https://YOUR-TARGET-SITE/*',
          // An iframe is a separate document with its own URL. To reach a CROSS-ORIGIN
          // iframe, its origin must be matched here too — that is what lets Tampermonkey
          // inject the frame agent into it. Example:
          //   'https://*.services.example.com/*'
        ],
        // No @noframes: the script must be injected into iframes as well. main.ts mounts
        // the panel only in the top frame; iframes run the headless agent.
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_deleteValue',
          'GM_xmlhttpRequest',
          // ctx.shared: listing keys + live cross-tab change events.
          'GM_listValues',
          'GM_addValueChangeListener',
          'GM_removeValueChangeListener',
        ],
        // No @require: preact/hooks/htm are bundled. The script is fully self-contained,
        // so it also works when someone @requires it from their own wrapper userscript.
        'run-at': 'document-idle',
      },
      build: {
        fileName: 'nb-steprunner.user.js',
      },
    }),
  ],
});
