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
- [Sharing state across tabs and sites](#sharing-state-across-tabs-and-sites)
- [Working across iframes](#working-across-iframes)
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
- **Real code editor** — CodeMirror 6 with JavaScript syntax highlighting, proper Tab indentation, bracket matching, and Ctrl/Cmd+Enter to run.
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
to an immutable tag. The bundle is self-contained (preact, htm and CodeMirror are all inside),
so the engine line is the only `@require` you need:

```js
// ==UserScript==
// @name         my-site-notebook
// @match        https://your-target-site/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_listValues                // ctx.shared: list/inspect keys
// @grant        GM_addValueChangeListener    // ctx.shared: live cross-tab events
// @grant        GM_removeValueChangeListener
// @require      https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner@vX.Y.Z/dist/nb-steprunner.user.js
// ==/UserScript==
```

> When you `@require` a file, **its own metadata header is ignored** — the engine runs under
> *your* wrapper's grants, so your wrapper must declare every `@grant` the engine uses, plus
> `@match` (and `@connect` if you use `gmFetch` cross-origin). The list above is complete; miss
> one and the feature that needs it fails (e.g. without the `ctx.shared` grants, cross-tab
> sharing silently does nothing).
>
> **Pin a real version** in place of `@vX.Y.Z` (e.g. `@v0.9.0`). A bare URL without `@tag`
> resolves to the repository's default branch on jsDelivr, which may lag behind the latest
> release — pinning a tag is both immutable and current.

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

> "Probe" is not an abbreviation — it is the instrument sense of the word: a cell you poke a
> stubborn element with, repeatedly, until you understand how it responds. Probes stay out of
> Run All precisely because they are for exploring, not for the flow.

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

The shared `ctx` has four zones. They behave identically while a cell runs — the difference
is **what survives, and how far**:

| Zone | Survives a reload? | Visible to other tabs / sites? | For |
|---|---|---|---|
| `ctx.data` | ✅ snapshotted to the checkpoint | ❌ | Serializable progress state |
| `ctx.refs` | ❌ dropped | ❌ | DOM nodes, editor/terminal handles |
| `ctx.lib` (`lib`) | ❌ rebuilt by `setup` cells | ❌ | Reusable functions |
| `ctx.shared` (`shared`) | ✅ persisted in GM storage | ✅ **everywhere** | Cross-tab handoff |

`data` vs `refs` is not about how you write code — both are plain objects you can use from
any cell. It is about the checkpoint: only `ctx.data` is snapshotted. A DOM node cannot be
serialized, and would point at a destroyed element after a reload anyway, so live handles
belong in `refs` where they are deliberately discarded. Putting them in `data` isn't fatal
(the snapshot skips what it cannot clone) but it makes checkpoints bigger and hides the
intent.

```js
// gmFetch example (declare `// @connect api.example.com` in the userscript)
const res = await gmFetch('https://api.example.com/data', {
  method: 'GET',
  headers: { Authorization: 'Bearer …' },
  responseType: 'json',
});
print(res.status, res.response);
```

## Sharing state across tabs and sites

GM storage belongs to the **userscript**, not to a page — so every tab running this script
reads and writes the same store, whatever site it is on. `ctx.shared` (`shared` in a cell)
exposes that as an async key/value store, which is how a tab on site A hands data to a tab
on site B.

| Call | Description |
|---|---|
| `await shared.set(k, v)` | Write a value (structured-cloneable). |
| `await shared.get(k, def?)` | Read a value. |
| `await shared.wait(k, { timeout, interval })` | Block until a key is set — by any tab. Honours **Stop**. |
| `await shared.delete(k)` / `clear()` | Remove one key / all keys. |
| `await shared.keys()` / `all()` | List keys / everything with provenance. |
| `await shared.meta(k)` | Which host wrote the key, and when. |
| `await shared.request(ch, payload, { timeout })` | **Ask** another tab and get the matching answer (see below). |
| `await shared.serve(ch, handler, { timeout })` | **Answer** requests — the server side; run it in a looping cell. |
| `shared.onChange(cb)` | Low-level live changes; returns an unsubscribe function. |

Each key is its own storage entry, so two tabs writing **different** keys never clobber each
other. Two tabs writing the **same** key is still last-write-wins.

```js
// Tab on site A — produce
await shared.set('jobId', ctx.data.id);

// Tab on site B — consume (blocks until A writes it)
const jobId = await shared.wait('jobId', { timeout: 120000 });
print('got', jobId, 'from', (await shared.meta('jobId')).host);

// React live instead of blocking
shared.onChange((key, value, info) => {
  if (info.remote) print(`${key} = ${value} (from ${info.from})`);
});
```

### Ask one tab, answer from another (request / serve)

One tab **asks** with `request`; another tab is the **server** that answers with `serve`.
Each answer is matched to its request by a unique id, so a leftover answer from an earlier
exchange can never come back by mistake — and both sides work by polling, so **the order you
start them in does not matter** and no `@grant` for live events is needed.

**Tab A — ask.** Any cell; run it whenever you want an answer:

```js
const answer = await shared.request('gemini', { prompt: 'hello' }, { timeout: 60000 });
print('answer:', answer);
```

**Tab B — the server.** Put this in ONE **step** cell, then press **▶▶ Run All with the
`loop` checkbox ON**. That built-in loop *is* the server loop: `serve` waits for a request,
answers it, and the loop runs it again for the next one. Press **■ Stop** to shut it down.

```js
// Handles one request per loop tick. The value you return goes back to Tab A.
await shared.serve('gemini', async (prompt) => {
  return `got: ${prompt.prompt}`;
});
```

That is the whole model:

- **Ask** → `request`, in any cell, run on demand.
- **Answer** → `serve`, in a step cell, **Run All + loop ON** (Stop to end it).

If the handler throws, the asking tab's `request()` rejects with that message. Both sides
clean up their own keys, so nothing piles up. `serve` also takes `{ timeout }` if you want a
single, non-looping run that gives up after a while (it returns `false` on timeout).

> Prefer this over the low-level `onChange`. `onChange` is an event listener: it only hears
> requests sent *after* it is armed, and if you put it in a loop it re-subscribes every
> iteration (one request then answered many times). `serve` + the loop avoids both traps.

> **Read this before putting anything sensitive in `shared`.** The store is not partitioned
> by site: **every** site in your `@match` can read **everything** in it, and so can any
> notebook you import and run. It is written to disk unencrypted by the userscript manager.
> Values carry a `host` tag so you can audit where they came from (`shared.all()`), and the
> first write logs a warning to the console. Keep credentials and tokens out of it unless you
> trust every matched site — a token from site A is readable by a cell running on site B.
>
> Both requirements are the same one: for a tab to participate, its site must be in `@match`,
> which also means the script (with GM privileges) runs there. Keep match patterns narrow.

For managers without `GM_addValueChangeListener`, `onChange` stays silent but `get`/`set`/
`wait` still work — `shared.live` tells you which you have.

## Working across iframes

An `<iframe>` is a separate document, and for a cross-origin one the browser blocks DOM
access outright — that limit comes from the same-origin policy, not from Tampermonkey.
What a userscript *can* do, and page JavaScript cannot, is run **inside** that frame:
Tampermonkey injects into every frame whose URL matches, so the panel (top frame) and a
headless **frame agent** (each iframe) talk over `postMessage`.

> **Add the iframe's origin to `@match`.** This is the step people miss. If the frame is on
> another domain and that domain is not matched, no agent is injected and `frames.run` will
> time out. `@noframes` must stay off.

| Call | Description |
|---|---|
| `frames.list()` | Inventory: `{ index, src, id, sameOrigin, ready }`. |
| `frames.doc(t)` | The frame's `Document` — same-origin only, `null` otherwise. |
| `frames.ready(t)` | Wait until a cross-origin frame's agent answers. |
| `frames.run(t, fn, args?)` | Run code in the frame and return its result. |

`t` is an index, a CSS selector for the iframe, or the element itself. `frames.run` works
for both cases — same-origin runs locally, cross-origin ships the code to the agent.

Two rules follow from the code being **stringified and re-parsed** in the other frame:
it cannot capture variables from the calling cell (pass them via `args`), and the return
value must be structured-cloneable (a DOM node cannot travel — return data about it).
Inside the frame you get `doc`, `win`, `args`, `$`, `$$`, `sleep`, `waitFor`, `print`;
`print` output is forwarded to the calling cell's output pane.

```js
// Paste into an xterm.js terminal living in a cross-origin iframe.
// The synthetic ClipboardEvent never touches the system clipboard, so it sidesteps
// the permission/focus rules that make navigator.clipboard unreliable in frames.
await frames.run('iframe#embedded-resource', (text) => {
  const ta = doc.querySelector('.xterm-helper-textarea');
  if (!ta) throw new Error('terminal not rendered yet');
  ta.focus();
  const ev = new ClipboardEvent('paste', {
    clipboardData: new DataTransfer(), bubbles: true, cancelable: true,
  });
  ev.clipboardData.setData('text/plain', text);
  ta.dispatchEvent(ev);
  return 'pasted';
}, 'ls -la\n');

// Read the terminal back — return the text, don't try to return nodes.
const screen = await frames.run('iframe#embedded-resource', () =>
  $$('.xterm-accessibility-tree [role="listitem"]')
    .map((n) => n.innerText.replace(/\u00a0/g, " "))
    .join('\n')
    .trimEnd()
);
print(screen);
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

### Developing on strict-CSP / Trusted Types sites

HMR (`bun run dev`) injects an external `<script>` for the dev client. Sites that enforce
**Trusted Types** (`require-trusted-types-for 'script'`) block that injection, so the panel
won't load in dev mode there. The production build is unaffected (cells run via blob-module import).

Two workarounds:

- **Iterate on a permissive page**, then verify the build on the real target. The panel and logic
  are site-agnostic, so `bun run dev` on any non-Trusted-Types page is fine for UI/logic work.
- **`bun run build:watch`** — rebuild `dist/` on every save and reinstall it in Tampermonkey.

> The Tampermonkey editor may show many ESLint warnings (`no-sequences`, `no-multi-spaces`,
> `no-redeclare`, …) on the **minified** `dist/`. These are cosmetic linter noise on bundled code,
> not errors — the script runs fine. Disable them in Tampermonkey → Settings → Editor if they bother you.

## Architecture

Layered (MVC-ish); the output is a **single self-contained** userscript — preact, htm and
CodeMirror are bundled, so there are no CDN `@require`s and no load-order assumptions.

| Layer | Files |
|---|---|
| **Model** | `storage.ts` (GM, per-host), `kernel.ts` (runCell), `compile.ts` (blob-module), `ctx.ts`, `checkpoint.ts`, `io.ts`, `types.ts`, `constants.ts`, `util.ts` |
| **Helpers** | `helpers.ts`, `frames.ts` (top-frame side), `frame-agent.ts` (in-frame side), `frame-rpc.ts` (protocol) |
| **View** | `ui/App.ts`, `ui/editor.ts` (CodeMirror 6), `ui/styles.ts`, `ui/layout.ts` (position clamping) |
| **Entry** | `main.ts` — panel in a Shadow DOM (top frame) or headless agent (iframes) |

## Security

- Never `@require` **live** engine code from a third-party server — a compromise would run
  arbitrary code with GM privileges on every matched site (supply-chain risk).
- Distribute from an **immutable** tag/commit (jsDelivr), optionally with an `#sha256=` integrity hash.
- Importing someone else's notebook means running their code on the target site. Treat notebooks as trusted code.
- The frame agent executes only code posted by `window.top` — its own top frame. Widening
  `@match` to reach an iframe also injects the agent into every other page on that origin,
  so keep the match patterns as narrow as the frame you actually need.

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
