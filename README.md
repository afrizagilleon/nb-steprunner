# nb-steprunner

A notebook-style **step runner** inside any web page, packaged as a Tampermonkey userscript.
Each cell runs independently (like Jupyter) with a shared `ctx`, resume/checkpoint on error,
Run All + loop for SPAs, and import/export (JSON & Markdown).

Cells execute via **blob-module import** (not `eval`/`new Function`) so they run under strict
site CSPs. The cell editor lives in a panel; sources are stored per-host in GM storage.

## Install (users)

Install in Tampermonkey. For a release (example via jsDelivr, pinned to a tag):

```
// @require https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner@vX.Y.Z/dist/nb-steprunner.user.js
```

Or install `dist/nb-steprunner.user.js` directly. **You must change `@match`** to your target site.

## Development (contributors)

Requires [Bun](https://bun.sh).

```bash
bun install          # deps
bun run dev          # dev server (vite-plugin-monkey, auto-reload)
bun run build        # -> dist/nb-steprunner.user.js
bun run typecheck    # tsc --noEmit
```

`bun run dev` serves a dev userscript you install once in Tampermonkey; it auto-reloads when
the source changes — no need to re-paste.

## Architecture (`src/`)

Layered (MVC-ish); the output stays a SINGLE userscript. preact/hooks/htm come from the CDN
(`@require`) and are not bundled.

| Layer | Files |
|---|---|
| **Model** | `storage.ts` (GM, per-host), `kernel.ts` (compile+runCell), `ctx.ts`, `checkpoint.ts`, `io.ts` (import/export), `types.ts`, `constants.ts`, `util.ts` |
| **Helpers** | `helpers.ts` (`$`, `$$`, `sleep`, `gmFetch`, `waitFor`, `print`) |
| **View** | `ui/App.ts` (panel), `ui/styles.ts` |
| **Entry** | `main.ts` (mount into a Shadow DOM) |

## Cell concepts

- **step** — a flow step; included in Run All; success advances the resume point + snapshots `ctx.data`.
- **setup** — auto-runs on load; the place to define reusable functions on `ctx.lib` (`lib`).
- **probe** — experiment with special elements (Monaco/terminal); store a handle on `ctx.refs`.

`ctx.data` (serializable) is snapshotted to the checkpoint & restored on reload; `ctx.refs`/`ctx.lib`
are ephemeral (rebuilt by setup/probe cells).

## Security

- Do not `@require` live engine code from a third-party server (supply-chain risk).
- Distribute from an **immutable** tag/commit (jsDelivr), optionally with an `#sha256=` integrity hash.
- Importing someone else's notebook = running their code on the target site. Treat it as trusted code.

See `PLANNING.md` for design details & roadmap.
