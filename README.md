<h1 align="center">Notebook Steprunner</h1>

<p align="center">
  <strong>Debug and automate any website interactively — Jupyter-style cells, right inside your browser.</strong>
</p>

<p align="center">
  <a href="https://github.com/afrizagilleon/nb-steprunner/actions/workflows/ci.yml"><img src="https://github.com/afrizagilleon/nb-steprunner/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/userscript-Tampermonkey-brightgreen" alt="Tampermonkey">
  <img src="https://img.shields.io/badge/built%20with-Preact%20%2B%20Vite-673ab8" alt="Preact + Vite">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

Notebook Steprunner turns any web page into an interactive notebook. You write small **cells**
of JavaScript that run one at a time — like Jupyter — but with full access to the live DOM of
the page you are on. State is shared between cells, survives errors, and can resume after a
reload, so you can iterate on scraping and automation flows **without re-running everything from
scratch**.

It runs as a single Tampermonkey userscript. Cells execute through **blob-module imports**
(not `eval`), so they work even on sites with a strict Content-Security-Policy.

## Demo

<!-- 📹 Demo video goes here -->
> _Demo video coming soon._

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Install](#install)
- [Quick start](#quick-start)
- [Cell types](#cell-types)
- [Helpers &amp; `ctx`](#helpers--ctx)
- [Import / Export](#import--export)
- [Development](#development)
- [Architecture](#architecture)
- [Security](#security)
- [Background — why this exists](#background--why-this-exists)

## Features

- **Run cells independently** — execute one step at a time against the live page, no reload, no console copy-paste.
- **Shared `ctx`** — pass data between cells like a Jupyter kernel; it persists between runs.
- **Resume / checkpoint** — on error the run stops *safely*; `ctx.data` is snapshotted and restored after a reload so you continue from the last successful step, not from zero.
- **Run All + Loop** — run enabled steps top-to-bottom, optionally looping (with delay, max-iterations, and a `stop` / `continue` / `reload` on-error policy) — built for long-running SPA automation.
- **Selector helpers** — `$`, `$$`, `sleep`, `waitFor`, `gmFetch`, `print` are injected into every cell (and exposed on `window` for the DevTools console).
- **Reusable library** — define helpers once in a `setup` cell (auto-run on load) and call them from any cell via `lib`.
- **Special-element probes** — dedicated `probe` cells for editors/terminals you need to poke repeatedly.
- **Import / Export** — JSON (backup) and Markdown (Obsidian-friendly, round-trip).
- **Reorder, exclude, rename** — drag to reorder; toggle a cell out of Run All; per-host notebooks stored in GM storage.

## How it works

Most notebook-in-the-browser ideas break on strict sites because the browser's CSP blocks
`eval` / `new Function`. Notebook Steprunner sidesteps that: each cell's source is wrapped into
an ES module, turned into a `blob:` URL, and loaded with dynamic `import()`. That path is governed
by `script-src blob:`, **not** `unsafe-eval`, so cells run where `eval` would be rejected.

Each cell is compiled to `export default async (api) => { … }` and invoked with an `api` object
carrying `ctx` and the helpers. Top-level `await` works natively inside a cell.

## Install

Install [Tampermonkey](https://www.tampermonkey.net/), then either:

**A. Direct (recommended for most users)** — install `dist/nb-steprunner.user.js`. It is a
complete userscript with its own metadata and auto-update. **Change `@match` to your target site.**

**B. Via `@require` (advanced)** — reference the engine from your own wrapper userscript, pinned
to an immutable tag:

```js
// @require https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner@vX.Y.Z/dist/nb-steprunner.user.js
```

> When you `@require` a file, **its own metadata header is ignored**. Your wrapper must declare
> the required `@grant`, `@match`, `@connect`, and the preact/htm `@require` lines itself.

## Quick start

1. Open your target site. A floating 🧪 panel appears (drag it; click ✕ to minimize — the
   minimized button is draggable too).
2. Click **+ Cell**, write some code, and press **Ctrl+Enter** (or ▶):

   ```js
   ctx.data.links = $$('a').length;
   print('links on page:', ctx.data.links);
   return ctx.data.links;
   ```

3. Add another cell — it can read what the first one stored:

   ```js
   print('from previous cell:', ctx.data.links);
   ```

4. Reload the page. The panel restores `ctx.data` from the checkpoint and shows a **resume**
   marker, so you continue from where you left off.

## Cell types

| Type | Purpose |
|---|---|
| **step** | A flow step. Included in **Run All**. On success it advances the resume point and snapshots `ctx.data`. |
| **setup** | Runs automatically on load (and after reload). Define reusable functions on `lib`. Never touches the checkpoint. |
| **probe** | Experiment with tricky elements (Monaco, xterm, contenteditable). Store handles on `ctx.refs`; excluded from Run All. |

## Helpers & `ctx`

Injected into every cell:

| Helper | Description |
|---|---|
| `$(sel, root?)` | `querySelector`, shorthand. |
| `$$(sel, root?)` | `querySelectorAll` as an array. |
| `sleep(ms)` | Promise-based delay. |
| `waitFor(sel, { timeout, interval, root })` | Poll until an element appears (or time out) — replaces brittle fixed `sleep` calibration. |
| `gmFetch(url, opts)` | Promise wrapper over `GM_xmlhttpRequest` (cross-origin needs `@connect`). |
| `print(...args)` | Write to the cell's output pane. |

The shared `ctx` has three zones:

- **`ctx.data`** — serializable state; snapshotted to the checkpoint and restored on reload.
- **`ctx.refs`** — ephemeral handles (DOM nodes, editor instances); rebuilt by probes.
- **`ctx.lib`** (`lib`) — reusable functions, defined in `setup` cells.

```js
// gmFetch example (declare `// @connect api.example.com` in the userscript)
const res = await gmFetch('https://api.example.com/data', {
  method: 'GET',
  headers: { Authorization: 'Bearer …' },
  responseType: 'json',
});
print(res.status, res.response);
```

## Import / Export

- **⇩json** — export the current host's notebook for backup or moving between machines.
- **⇩md** — export to Markdown (`### name` + a meta comment + a `js` fence); edit it in Obsidian.
- **⇧import** — import `.json` or `.md`. Plain Markdown (`## heading` + `js` fence, no meta) is
  also parsed, so legacy Obsidian notes come in as `step` cells.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install          # install dependencies
bun run dev          # dev server (vite-plugin-monkey, auto-reload in Tampermonkey)
bun run build        # -> dist/nb-steprunner.user.js
bun run typecheck    # tsc --noEmit
```

`bun run dev` serves a dev userscript you install once; it hot-reloads as you edit — no re-pasting.

## Architecture

Layered (MVC-ish); the output stays a **single** userscript. preact / preact hooks / htm are
loaded from the CDN via `@require` and are not bundled.

| Layer | Files |
|---|---|
| **Model** | `storage.ts` (GM, per-host), `kernel.ts` (compile + runCell), `ctx.ts`, `checkpoint.ts`, `io.ts`, `types.ts`, `constants.ts`, `util.ts` |
| **Helpers** | `helpers.ts` |
| **View** | `ui/App.ts`, `ui/styles.ts` |
| **Entry** | `main.ts` (mounts into a Shadow DOM) |

## Security

- Never `@require` **live** engine code from a third-party server — a compromise would run
  arbitrary code with GM privileges on every matched site (supply-chain risk).
- Distribute from an **immutable** tag/commit (jsDelivr), optionally with an `#sha256=` integrity hash.
- Importing someone else's notebook means running their code on the target site. Treat notebooks as trusted code.

## Background — why this exists

> _My own words, lightly edited._

For years I automated websites by hand: hunting for the right selector, reading and clicking
elements, hard-coding conditions from their values and attributes. I wanted to keep that part
manual — sites change, and brittle auto-selectors are more trouble than they are worth.

The pain was never the manual analysis. It was **the loop around it**. A single `await sleep()`
between two clicks had to be recalibrated over and over, each time meaning another full reload.
Special elements — a code editor, a terminal — needed to be poked repeatedly in the DevTools
console before I trusted that the value came through or the action fired. API calls went out
through `GM_xmlhttpRequest`. And everything lived in one growing script.

My workflow was Markdown in Obsidian → a `generateScript.ts` that scraped the code blocks into a
single Tampermonkey script → paste → reload. It worked, but development was ambiguous and slow,
and the script had grown too big to keep reloading. Worse, in single-page apps a single error
would just halt; my only fallback was try/catch → reload the page → run the whole thing again
from the top — which is genuinely dangerous when steps have side effects.

So I built the thing I actually wanted: a **notebook-style step runner living inside the page**.
Run just the part you're debugging, keep shared state between runs, resume after an error instead
of starting over, and stop typing `document.querySelector(...)` a hundred times a day. I looked
for an existing tool that combined manual selectors, resume-on-error, and special-element handling
in one in-page userscript — and didn't find one. So this became the opportunity.

---

<p align="center"><sub>Built with Preact + htm + Vite · packaged as a Tampermonkey userscript · MIT licensed.</sub></p>
