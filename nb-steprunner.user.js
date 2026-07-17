// ==UserScript==
// @name         nb-steprunner
// @version      0.3.0
// @author       Afriza
// @description  Notebook-style step runner di dalam page: tiap cell dijalankan independen (blob-module), ctx bersama, resume/checkpoint, helper selector. Editor cell di panel.
// @match        https://GANTI-SITUS-TARGET-ANDA/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/dist/preact.umd.js
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/hooks/dist/hooks.umd.js
// @require      https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js
// @run-at       document-idle
// ==/UserScript==

/*
 * Arsitektur (lihat PLANNING.md):
 *   storage  -> GM, namespacing per-host, versi nb:v1:
 *   kernel   -> compile cell (blob-module import) + runCell + ctx
 *   ctx      -> { data (serializable, disnapshot), refs (ephemeral) }
 *   helpers  -> $, $$, sleep, gmFetch, waitFor, print
 *   checkpt  -> lastSuccessCellId + snapshot ctx.data; restore saat reload
 *   ui       -> panel Preact (list cell, editor, run, output)
 *
 * CSP: situs target memblok eval/new Function; eksekusi WAJIB via blob-module.
 */

(function () {
  'use strict';

  const { h, render } = window.preact;
  const { useState, useEffect, useRef, useCallback } = window.preactHooks;
  const html = window.htm.bind(h);

  // =========================================================================
  // 1. STORAGE LAYER
  // =========================================================================
  const SCHEMA = 'nb:v1';
  const host = location.host;
  const hostKey = (suffix) => `${SCHEMA}:${host}:${suffix}`;
  const globalKey = (suffix) => `${SCHEMA}:${suffix}`;

  // Bungkus GM get/set supaya aman untuk varian sinkron (GM_) maupun promise (GM.).
  const gmGet = async (key, def) => await GM_getValue(key, def);
  const gmSet = async (key, val) => await GM_setValue(key, val);

  const KEY_NOTEBOOK = () => hostKey('notebook');
  const KEY_CHECKPOINT = () => hostKey('checkpoint');
  const KEY_PANELPOS = globalKey('panelPos');
  const KEY_MINIPOS = globalKey('miniPos');

  const emptyNotebook = () => ({ version: 1, cells: [] });

  async function loadNotebook() {
    const nb = await gmGet(KEY_NOTEBOOK(), null);
    if (!nb || !Array.isArray(nb.cells)) return emptyNotebook();
    return nb;
  }
  async function saveNotebook(nb) {
    await gmSet(KEY_NOTEBOOK(), nb);
  }
  async function loadCheckpoint() {
    return await gmGet(KEY_CHECKPOINT(), null);
  }
  async function saveCheckpoint(cp) {
    await gmSet(KEY_CHECKPOINT(), cp);
  }

  const uid = () =>
    (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  const DEFAULT_SOURCE = {
    step: "// cell baru\nprint('halaman:', document.title);\n",
    probe: "// probe: bangun handle ke ctx.refs, jalankan berulang\n// ctx.refs.editor = $('.monaco-editor');\n",
    setup: "// setup: dijalankan otomatis saat load (& setelah reload).\n// Taruh fungsi reusable di lib -> dipakai cell lain lewat lib.namaFn().\nlib.hello = () => print('hai dari lib');\n",
  };

  // =========================================================================
  // 2. HELPERS + ctx
  // =========================================================================
  // ctx.data  -> serializable, disnapshot ke checkpoint & di-restore saat reload
  // ctx.refs  -> ephemeral (DOM node, instance editor), TIDAK dipersist
  // ctx.lib   -> ephemeral, rumah baku untuk FUNGSI reusable (diisi via cell 'setup')
  const ctx = { data: {}, refs: {}, lib: {} };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  async function waitFor(sel, opts = {}) {
    const { timeout = 5000, interval = 100, root = document } = opts;
    const start = Date.now();
    for (;;) {
      const el = root.querySelector(sel);
      if (el) return el;
      if (Date.now() - start > timeout) {
        throw new Error(`waitFor timeout (${timeout}ms): ${sel}`);
      }
      await sleep(interval);
    }
  }

  const gmFetch = (url, opts = {}) =>
    new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: opts.method || 'GET',
          url,
          ...opts,
          onload: (r) => resolve(r),
          onerror: (e) => reject(new Error('gmFetch error: ' + (e && e.error))),
          ontimeout: () => reject(new Error('gmFetch timeout: ' + url)),
        });
      } catch (e) {
        reject(e);
      }
    });

  // Ekspor helper ke window juga -> bisa dipakai dari DevTools console saat eksplorasi manual.
  try {
    window.$ = $;
    window.$$ = $$;
    window.sleep = sleep;
    window.waitFor = waitFor;
    window.gmFetch = gmFetch;
    window.nbCtx = ctx;
  } catch (_) {
    /* beberapa halaman freeze window; abaikan */
  }

  // =========================================================================
  // 3. KERNEL (blob-module compile + runCell)
  // =========================================================================
  // Header yang disuntik otomatis -> cell bisa langsung pakai `$`, `ctx`, dst
  // tanpa prefix `api.` (tetap tersedia lewat `api` bila diperlukan).
  const CELL_HEADER =
    'const { ctx, lib, $, $$, sleep, gmFetch, waitFor, print } = api;\n';

  async function compile(cell) {
    const moduleCode =
      `export default async (api) => {\n${CELL_HEADER}${cell.source}\n};\n` +
      `//# sourceURL=nb-cell-${cell.name || cell.id}.js`;
    const url = URL.createObjectURL(
      new Blob([moduleCode], { type: 'text/javascript' })
    );
    try {
      const mod = await import(/* webpackIgnore: true */ url);
      return mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function fmt(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Element) return `<${v.tagName.toLowerCase()}> ${v.className || ''}`.trim();
    if (v instanceof Node) return `[${v.nodeName}]`;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  // runCell menjalankan satu cell. onEvent(status, outputText) untuk update UI.
  async function runCell(cell) {
    const out = [];
    const print = (...a) => out.push(a.map(fmt).join(' '));
    const api = { ctx, lib: ctx.lib, $, $$, sleep, gmFetch, waitFor, print };
    try {
      const fn = await compile(cell);
      const result = await fn(api);
      if (result !== undefined) out.push(fmt(result));
      const text = out.join('\n');
      // Hanya cell 'step' yang menggeser titik resume + snapshot progres.
      // 'setup'/'probe' bukan langkah alur, jadi tak mengubah checkpoint.
      if (cell.kind === 'step') await checkpoint.markSuccess(cell.id);
      return { ok: true, result, output: text };
    } catch (err) {
      const text =
        out.join('\n') +
        (out.length ? '\n' : '') +
        '✖ ' + String(err && err.stack ? err.stack : err);
      return { ok: false, error: err, output: text };
    }
  }

  // =========================================================================
  // 4. CHECKPOINT MANAGER
  // =========================================================================
  // Snapshot hanya ctx.data yang serializable. Node DOM ada di ctx.refs -> tak ikut.
  function safeSnapshot(data) {
    try {
      return structuredClone(data);
    } catch (_) {
      // fallback: buang field yang tak bisa diserialisasi, jangan gagal total
      const out = {};
      for (const [k, v] of Object.entries(data)) {
        try {
          out[k] = JSON.parse(JSON.stringify(v));
        } catch {
          console.warn(`[nb] skip ctx.data.${k} (non-serializable)`);
        }
      }
      return out;
    }
  }

  const checkpoint = {
    lastSuccessCellId: null,
    async markSuccess(cellId) {
      this.lastSuccessCellId = cellId;
      await saveCheckpoint({
        lastSuccessCellId: cellId,
        data: safeSnapshot(ctx.data),
        savedAt: Date.now(),
      });
    },
    // Dipanggil sekali saat bootstrap: pulihkan ctx.data dari checkpoint.
    async restore() {
      const cp = await loadCheckpoint();
      if (!cp) return null;
      if (cp.data && typeof cp.data === 'object') {
        Object.assign(ctx.data, cp.data);
      }
      this.lastSuccessCellId = cp.lastSuccessCellId || null;
      return cp;
    },
    async clear() {
      this.lastSuccessCellId = null;
      await saveCheckpoint(null);
    },
  };

  // =========================================================================
  // 5. UI (Panel Preact)
  // =========================================================================
  function App() {
    const [cells, setCells] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [statuses, setStatuses] = useState({}); // id -> 'idle'|'running'|'ok'|'error'
    const [outputs, setOutputs] = useState({});   // id -> string
    const [resumeId, setResumeId] = useState(null);
    const [visible, setVisible] = useState(true);
    const [pos, setPos] = useState({ x: 20, y: 20, w: 420, h: 480, listW: 130, outH: 130 });
    const [miniPos, setMiniPos] = useState({ x: 20, y: 80 });
    const [loaded, setLoaded] = useState(false);

    const dragState = useRef(null);
    const resizeState = useRef(null);
    const miniDrag = useRef(null);
    const saveTimer = useRef(null);

    // ---- load awal: notebook + posisi + restore checkpoint ----
    useEffect(() => {
      (async () => {
        const nb = await loadNotebook();
        setCells(nb.cells);
        if (nb.cells[0]) setSelectedId(nb.cells[0].id);
        const savedPos = await gmGet(KEY_PANELPOS, null);
        if (savedPos) setPos((p) => ({ ...p, ...savedPos }));
        const savedMini = await gmGet(KEY_MINIPOS, null);
        if (savedMini) setMiniPos(savedMini);
        const cp = await checkpoint.restore();
        if (cp && cp.lastSuccessCellId) setResumeId(cp.lastSuccessCellId);
        // Auto-run cell 'setup' (mis. definisi lib) — tidak menggeser titik resume.
        for (const c of nb.cells.filter((x) => x.kind === 'setup')) {
          setStatuses((s) => ({ ...s, [c.id]: 'running' }));
          const res = await runCell(c);
          setStatuses((s) => ({ ...s, [c.id]: res.ok ? 'ok' : 'error' }));
          setOutputs((o) => ({ ...o, [c.id]: res.output }));
        }
        setLoaded(true);
      })();
    }, []);

    // ---- persist posisi ----
    useEffect(() => {
      if (loaded) gmSet(KEY_PANELPOS, pos);
    }, [pos, loaded]);

    useEffect(() => {
      if (loaded) gmSet(KEY_MINIPOS, miniPos);
    }, [miniPos, loaded]);

    // ---- persist notebook (debounce) ----
    const persistCells = useCallback((next) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveNotebook({ version: 1, cells: next });
      }, 400);
    }, []);

    function mutateCells(updater) {
      setCells((prev) => {
        const next = updater(prev);
        persistCells(next);
        return next;
      });
    }

    function addCell(kind) {
      const cell = {
        id: uid(),
        name: kind,
        source: DEFAULT_SOURCE[kind] || DEFAULT_SOURCE.step,
        kind,
      };
      mutateCells((prev) => [...prev, cell]);
      setSelectedId(cell.id);
    }

    function updateSource(id, source) {
      mutateCells((prev) =>
        prev.map((c) => (c.id === id ? { ...c, source } : c))
      );
    }
    function renameCell(id) {
      const name = prompt('Nama cell:');
      if (name == null) return;
      mutateCells((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    }
    function deleteCell(id) {
      mutateCells((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) setSelectedId(null);
    }

    async function doRun(cell) {
      setStatuses((s) => ({ ...s, [cell.id]: 'running' }));
      const res = await runCell(cell);
      setStatuses((s) => ({ ...s, [cell.id]: res.ok ? 'ok' : 'error' }));
      setOutputs((o) => ({ ...o, [cell.id]: res.output }));
      if (res.ok && cell.kind === 'step') setResumeId(cell.id);
    }

    // Tombol minimize: bisa DIGESER (drag) supaya tak tertutup UI halaman.
    // Klik (tanpa geser) = buka panel. Geser >3px = pindah, tidak membuka.
    const onMiniDown = (e) => {
      miniDrag.current = { sx: e.clientX, sy: e.clientY, ox: miniPos.x, oy: miniPos.y, moved: false };
      const move = (ev) => {
        const d = miniDrag.current; if (!d) return;
        if (Math.abs(ev.clientX - d.sx) > 3 || Math.abs(ev.clientY - d.sy) > 3) d.moved = true;
        setMiniPos({ x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy });
      };
      const up = () => {
        const d = miniDrag.current;
        miniDrag.current = null;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (d && !d.moved) setVisible(true);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    if (!visible) {
      const miniStyle = { ...st.mini, left: miniPos.x + 'px', top: miniPos.y + 'px', right: 'auto' };
      return html`<button onMouseDown=${onMiniDown} style=${miniStyle} title="klik: buka · geser: pindah">🧪</button>`;
    }

    // ---- drag / resize (dari nb-preact.js) ----
    const onDragStart = (e) => {
      dragState.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
      const move = (ev) => {
        const d = dragState.current; if (!d) return;
        setPos((p) => ({ ...p, x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy }));
      };
      const up = () => {
        dragState.current = null;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    const onResizeStart = (e) => {
      e.stopPropagation();
      resizeState.current = { sx: e.clientX, sy: e.clientY, ow: pos.w, oh: pos.h };
      const move = (ev) => {
        const r = resizeState.current; if (!r) return;
        setPos((p) => ({
          ...p,
          w: Math.max(300, r.ow + ev.clientX - r.sx),
          h: Math.max(240, r.oh + ev.clientY - r.sy),
        }));
      };
      const up = () => {
        resizeState.current = null;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    // Splitter vertikal: atur lebar panel cell (kiri).
    const onListResizeStart = (e) => {
      e.stopPropagation();
      const sx = e.clientX, ow = pos.listW;
      const move = (ev) =>
        setPos((p) => ({ ...p, listW: Math.max(90, Math.min(p.w - 140, ow + ev.clientX - sx)) }));
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    // Splitter horizontal: atur tinggi area output (bawah). Geser ke atas = lebih tinggi.
    const onOutResizeStart = (e) => {
      e.stopPropagation();
      const sy = e.clientY, oh = pos.outH;
      const move = (ev) =>
        setPos((p) => ({ ...p, outH: Math.max(36, Math.min(p.h - 180, oh - (ev.clientY - sy))) }));
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    const selected = cells.find((c) => c.id === selectedId) || null;
    const panelStyle = { ...st.panel, left: pos.x + 'px', top: pos.y + 'px', width: pos.w + 'px', height: pos.h + 'px' };

    return html`
      <div style=${panelStyle}>
        <div style=${st.header} onMouseDown=${onDragStart}>
          <span>🧪 nb-steprunner <small style=${st.host}>${host}</small></span>
          <button onClick=${() => setVisible(false)} style=${st.iconBtn}>✕</button>
        </div>

        <div style=${st.toolbar}>
          <button style=${st.smallBtn} onClick=${() => addCell('step')}>+ Cell</button>
          <button style=${st.smallBtn} onClick=${() => addCell('setup')}>+ Setup</button>
          <button style=${st.smallBtn} onClick=${() => addCell('probe')}>+ Probe</button>
          ${resumeId && html`<span style=${st.resume}>lanjut dari: ${(cells.find((c) => c.id === resumeId) || {}).name || '?'}</span>`}
        </div>

        <div style=${st.main}>
          <div style=${st.topArea}>
            <div style=${{ ...st.list, width: pos.listW + 'px' }}>
              ${cells.length === 0 && html`<div style=${st.empty}>Belum ada cell. Klik + Cell.</div>`}
              ${cells.map((c) => html`
                <div key=${c.id} style=${{ ...st.cellRow, ...(c.id === selectedId ? st.cellRowActive : {}) }}
                     onClick=${() => setSelectedId(c.id)}>
                  <span style=${st.dot(statuses[c.id])}></span>
                  <span style=${st.cellName}>${c.name}${c.kind !== 'step' ? ' ·' + c.kind : ''}</span>
                  <button style=${st.runBtn} onClick=${(e) => { e.stopPropagation(); doRun(c); }}>▶</button>
                </div>
              `)}
            </div>

            <div style=${st.vsplit} onMouseDown=${onListResizeStart}></div>

            <div style=${st.editorPane}>
              ${selected ? html`
                <div style=${st.editorHead}>
                  <span style=${st.editorTitle}>${selected.name}</span>
                  <span>
                    <button style=${st.linkBtn} onClick=${() => renameCell(selected.id)}>rename</button>
                    <button style=${st.linkBtn} onClick=${() => deleteCell(selected.id)}>hapus</button>
                  </span>
                </div>
                <textarea style=${st.textarea} spellcheck=${false}
                  value=${selected.source}
                  onInput=${(e) => updateSource(selected.id, e.target.value)}
                  onKeyDown=${(e) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); doRun(selected); } }}
                ></textarea>
                <div style=${st.runRow}>
                  <button style=${st.primaryBtn} onClick=${() => doRun(selected)}>▶ Run (Ctrl+Enter)</button>
                </div>
              ` : html`<div style=${st.empty}>Pilih atau tambah cell.</div>`}
            </div>
          </div>

          <div style=${st.hsplit} onMouseDown=${onOutResizeStart}></div>

          <div style=${{ ...st.outputWrap, height: pos.outH + 'px' }}>
            <div style=${st.outputHead}>output${selected ? ' — ' + selected.name : ''}</div>
            <pre style=${st.output}>${selected ? (outputs[selected.id] || '') : ''}</pre>
          </div>
        </div>

        <div style=${st.resizeHandle} onMouseDown=${onResizeStart}></div>
      </div>
    `;
  }

  // =========================================================================
  // 6. STYLES
  // =========================================================================
  const st = {
    panel: { position: 'fixed', background: '#1e1e2e', color: '#cdd6f4', borderRadius: '10px', fontFamily: 'ui-monospace, monospace', fontSize: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 2147483647, overflow: 'hidden', display: 'flex', flexDirection: 'column', userSelect: 'none' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#313244', cursor: 'move', flex: '0 0 auto' },
    host: { opacity: 0.5, fontWeight: 'normal', marginLeft: 6 },
    toolbar: { display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #313244', flex: '0 0 auto' },
    resume: { marginLeft: 'auto', fontSize: 11, color: '#f9e2af' },
    main: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 },
    topArea: { display: 'flex', flex: '1 1 auto', minHeight: 0 },
    list: { borderRight: '1px solid #313244', overflowY: 'auto', flex: '0 0 auto' },
    vsplit: { width: 5, flex: '0 0 auto', cursor: 'col-resize', background: '#313244' },
    hsplit: { height: 5, flex: '0 0 auto', cursor: 'row-resize', background: '#313244' },
    outputWrap: { display: 'flex', flexDirection: 'column', flex: '0 0 auto', minHeight: 0 },
    outputHead: { padding: '3px 8px', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: '#89b4fa', background: '#181825', flex: '0 0 auto' },
    empty: { padding: 10, opacity: 0.5 },
    cellRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', cursor: 'pointer', borderBottom: '1px solid #26263a' },
    cellRowActive: { background: '#313244' },
    cellName: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    dot: (s) => ({ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: s === 'ok' ? '#a6e3a1' : s === 'error' ? '#f38ba8' : s === 'running' ? '#f9e2af' : '#585b70' }),
    runBtn: { background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: 12 },
    editorPane: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
    editorHead: { display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid #313244' },
    editorTitle: { color: '#89b4fa' },
    textarea: { flex: '1 1 auto', resize: 'none', border: 'none', outline: 'none', background: '#181825', color: '#cdd6f4', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, userSelect: 'text' },
    runRow: { padding: '6px 8px', borderTop: '1px solid #313244', flex: '0 0 auto' },
    output: { margin: 0, padding: 8, flex: '1 1 auto', overflow: 'auto', background: '#11111b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' },
    iconBtn: { background: 'none', border: 'none', color: '#cdd6f4', cursor: 'pointer' },
    smallBtn: { background: '#45475a', border: 'none', color: '#cdd6f4', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 11 },
    primaryBtn: { background: '#89b4fa', border: 'none', color: '#11111b', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontWeight: 'bold' },
    linkBtn: { background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: 11, marginLeft: 6 },
    mini: { position: 'fixed', top: 20, right: 20, zIndex: 2147483647, border: 'none', borderRadius: '50%', width: 38, height: 38, cursor: 'pointer', background: '#313244', color: '#fff', fontSize: 16 },
    resizeHandle: { position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, #89b4fa 50%)' },
  };

  // =========================================================================
  // 7. MOUNT
  // =========================================================================
  function mount() {
    const hostEl = document.createElement('div');
    hostEl.id = 'nb-steprunner-host';
    const shadow = hostEl.attachShadow({ mode: 'open' });
    document.body.appendChild(hostEl);
    render(html`<${App} />`, shadow);
  }

  mount();
})();
