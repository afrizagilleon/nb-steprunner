# nb-steprunner

Notebook-style **step runner** di dalam halaman web, sebagai userscript Tampermonkey.
Tiap cell dijalankan independen (seperti Jupyter) dengan `ctx` bersama, resume/checkpoint
saat error, Run All + loop untuk SPA, dan import/export (JSON & Markdown).

Eksekusi cell memakai **blob-module import** (bukan `eval`/`new Function`) agar lolos CSP
situs yang ketat. Editor cell ada di panel; source disimpan per-host di GM storage.

## Install (pengguna)

Pasang di Tampermonkey. Untuk rilis (contoh via jsDelivr, pin ke tag):

```
// @require https://cdn.jsdelivr.net/gh/afriza/nb-steprunner@vX.Y.Z/dist/nb-steprunner.user.js
```

Atau pasang langsung `dist/nb-steprunner.user.js`. **Wajib ganti `@match`** ke situs target.

## Development (kontributor)

Butuh [Bun](https://bun.sh).

```bash
bun install          # deps
bun run dev          # dev server (vite-plugin-monkey, auto-reload)
bun run build        # -> dist/nb-steprunner.user.js
bun run typecheck    # tsc --noEmit
```

`bun run dev` menyajikan userscript dev yang bisa dipasang di Tampermonkey dan auto-reload
saat source berubah — tak perlu paste-ulang.

## Arsitektur (`src/`)

Berlapis (analogi MVC); output tetap SATU userscript. preact/hooks/htm dari CDN (`@require`),
tidak di-bundle.

| Lapisan | File |
|---|---|
| **Model** | `storage.ts` (GM, per-host), `kernel.ts` (compile+runCell), `ctx.ts`, `checkpoint.ts`, `io.ts` (import/export), `types.ts`, `constants.ts`, `util.ts` |
| **Helpers** | `helpers.ts` (`$`, `$$`, `sleep`, `gmFetch`, `waitFor`, `print`) |
| **View** | `ui/App.ts` (panel), `ui/styles.ts` |
| **Entry** | `main.ts` (mount ke Shadow DOM) |

## Konsep cell

- **step** — langkah alur; ikut Run All; sukses menggeser titik resume + snapshot `ctx.data`.
- **setup** — auto-run saat load; tempat mendefinisikan fungsi reusable di `ctx.lib` (`lib`).
- **probe** — eksperimen elemen khusus (Monaco/terminal); simpan handle ke `ctx.refs`.

`ctx.data` (serializable) di-snapshot ke checkpoint & dipulihkan saat reload; `ctx.refs`/`ctx.lib`
ephemeral (di-rebuild oleh setup/probe).

## Keamanan

- Jangan `@require` kode-engine live dari server pihak-ketiga (supply-chain risk).
- Distribusi via tag/commit **immutable** (jsDelivr), opsional integrity `#sha256=`.
- Mengimpor notebook orang lain = menjalankan kode mereka di situs target. Perlakukan sebagai kode tepercaya.

Lihat `PLANNING.md` untuk detail desain & roadmap.
