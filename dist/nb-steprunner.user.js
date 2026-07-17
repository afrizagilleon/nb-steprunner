// ==UserScript==
// @name         nb-steprunner
// @namespace    https://github.com/afrizagilleon/nb-steprunner
// @version      0.6.0
// @author       Afriza
// @description  Notebook-style step runner inside the page: independent cells (blob-module), shared ctx, resume/checkpoint, Run All/loop, import/export. Cell editor in a panel.
// @license      MIT
// @homepage     https://github.com/afrizagilleon/nb-steprunner
// @downloadURL  https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/afrizagilleon/nb-steprunner/dist/nb-steprunner.user.js
// @match        https://YOUR-TARGET-SITE/*
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/dist/preact.umd.js
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/hooks/dist/hooks.umd.js
// @require      https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const p = window.preact;
  const hooks = window.preactHooks;
  p.h;
  const render = p.render;
  const html = window.htm.bind(p.h);
  const useState = hooks.useState;
  const useEffect = hooks.useEffect;
  const useRef = hooks.useRef;
  const useCallback = hooks.useCallback;
  const SCHEMA = "nb:v1";
  const VALID_KINDS = ["step", "setup", "probe"];
  const DEFAULT_SOURCE = {
    step: "// new cell\nprint('page:', document.title);\n",
    probe: "// probe: build a handle into ctx.refs, run repeatedly\n// ctx.refs.editor = $('.monaco-editor');\n",
    setup: "// setup: runs automatically on load (and after reload).\n// Put reusable functions on lib -> call them from other cells via lib.fnName().\nlib.hello = () => print('hi from lib');\n"
  };
  const CELL_HEADER = "const { ctx, lib, $, $$, sleep, gmFetch, waitFor, print } = api;\n";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function normalizeCell(c) {
    return {
      id: c.id || uid(),
      name: (c.name || "cell").toString(),
      source: (c.source != null ? c.source : "").toString(),
      kind: VALID_KINDS.includes(c.kind) ? c.kind : "step",
      enabled: c.enabled !== false
    };
  }
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function parseNotebookJSON(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : Array.isArray(data.cells) ? data.cells : [];
    return arr.map(normalizeCell);
  }
  function buildMarkdown(cells) {
    return cells.map((c) => {
      const meta = `<!-- nb:kind=${c.kind} enabled=${c.enabled !== false} -->`;
      return `### ${c.name}
${meta}
\`\`\`js
${c.source}
\`\`\`
`;
    }).join("\n");
  }
  function parseMarkdown(md) {
    const cells = [];
    const re = /^#{1,6}[ \t]+(.+?)[ \t]*\r?\n(?:<!--\s*nb:([^>]*?)-->\r?\n)?```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```/gm;
    let m;
    while ((m = re.exec(md)) !== null) {
      const meta = m[2] || "";
      const kind = (/kind=(\w+)/.exec(meta) || [])[1];
      const enabled = (/enabled=(\w+)/.exec(meta) || [])[1];
      cells.push(
        normalizeCell({
          name: m[1].trim(),
          source: m[3],
          kind,
          enabled: enabled !== "false"
        })
      );
    }
    return cells;
  }
  const host = location.host;
  const hostKey = (suffix) => `${SCHEMA}:${host}:${suffix}`;
  const globalKey = (suffix) => `${SCHEMA}:${suffix}`;
  const gmGet = async (key, def) => await GM_getValue(key, def);
  const gmSet = async (key, val) => await GM_setValue(key, val);
  const KEY_NOTEBOOK = () => hostKey("notebook");
  const KEY_CHECKPOINT = () => hostKey("checkpoint");
  const KEY_PANELPOS = globalKey("panelPos");
  const KEY_MINIPOS = globalKey("miniPos");
  const emptyNotebook = () => ({ version: 1, cells: [] });
  async function loadNotebook() {
    const nb = await gmGet(KEY_NOTEBOOK(), null);
    if (!nb || !Array.isArray(nb.cells)) return emptyNotebook();
    return { version: 1, cells: nb.cells.map(normalizeCell) };
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
  const ctx = { data: {}, refs: {}, lib: {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  async function waitFor(sel, opts = {}) {
    const { timeout = 5e3, interval = 100, root = document } = opts;
    const start = Date.now();
    for (; ; ) {
      const el = root.querySelector(sel);
      if (el) return el;
      if (Date.now() - start > timeout) {
        throw new Error(`waitFor timeout (${timeout}ms): ${sel}`);
      }
      await sleep(interval);
    }
  }
  const gmFetch = (url, opts = {}) => new Promise((resolve, reject) => {
    try {
      GM_xmlhttpRequest({
        method: opts.method || "GET",
        url,
        ...opts,
        onload: (r) => resolve(r),
        onerror: (e) => reject(new Error("gmFetch error: " + (e && e.error))),
        ontimeout: () => reject(new Error("gmFetch timeout: " + url))
      });
    } catch (e) {
      reject(e);
    }
  });
  function fmt(v) {
    if (typeof v === "string") return v;
    if (v instanceof Element)
      return `<${v.tagName.toLowerCase()}> ${v.className || ""}`.trim();
    if (v instanceof Node) return `[${v.nodeName}]`;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  const printStack = [];
  function print(...a) {
    const line = a.map(fmt).join(" ");
    const sink = printStack[printStack.length - 1];
    if (sink) sink(line);
    else console.log("[nb]", line);
  }
  try {
    const w = window;
    w.$ = $;
    w.$$ = $$;
    w.sleep = sleep;
    w.waitFor = waitFor;
    w.gmFetch = gmFetch;
    w.nbCtx = ctx;
  } catch (_) {
  }
  function safeSnapshot(data) {
    try {
      return structuredClone(data);
    } catch (_) {
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
        savedAt: Date.now()
      });
    },
    // Called once on bootstrap: restore ctx.data from the checkpoint.
    async restore() {
      const cp = await loadCheckpoint();
      if (!cp) return null;
      if (cp.data && typeof cp.data === "object") {
        Object.assign(ctx.data, cp.data);
      }
      this.lastSuccessCellId = cp.lastSuccessCellId || null;
      return cp;
    },
    async clear() {
      this.lastSuccessCellId = null;
      await saveCheckpoint(null);
    }
  };
  async function compile(cell) {
    const moduleCode = `export default async (api) => {
${CELL_HEADER}${cell.source}
};
//# sourceURL=nb-cell-${cell.name || cell.id}.js`;
    const url = URL.createObjectURL(
      new Blob([moduleCode], { type: "text/javascript" })
    );
    try {
      const mod = await import(
        /* @vite-ignore */
        url
      );
      return mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function runCell(cell) {
    const out = [];
    printStack.push((line) => out.push(line));
    const api = { ctx, lib: ctx.lib, $, $$, sleep, gmFetch, waitFor, print };
    try {
      const fn = await compile(cell);
      const result = await fn(api);
      if (result !== void 0) out.push(fmt(result));
      const text = out.join("\n");
      if (cell.kind === "step") await checkpoint.markSuccess(cell.id);
      return { ok: true, result, output: text };
    } catch (err) {
      const text = out.join("\n") + (out.length ? "\n" : "") + "✖ " + String(err && err.stack ? err.stack : err);
      return { ok: false, error: err, output: text };
    } finally {
      printStack.pop();
    }
  }
  const st = {
    panel: { position: "fixed", background: "#1e1e2e", color: "#cdd6f4", borderRadius: "10px", fontFamily: "ui-monospace, monospace", fontSize: "12px", boxShadow: "0 8px 24px rgba(0,0,0,.4)", zIndex: 2147483647, overflow: "hidden", display: "flex", flexDirection: "column", userSelect: "none" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#313244", cursor: "move", flex: "0 0 auto" },
    host: { opacity: 0.5, fontWeight: "normal", marginLeft: 6 },
    toolbar: { display: "flex", gap: 6, alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #313244", flex: "0 0 auto" },
    resume: { marginLeft: "auto", fontSize: 11, color: "#f9e2af" },
    controls: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #313244", flex: "0 0 auto", fontSize: 11 },
    ctrlLabel: { display: "inline-flex", alignItems: "center", gap: 3, color: "#a6adc8" },
    numIn: { width: 46, background: "#181825", color: "#cdd6f4", border: "1px solid #45475a", borderRadius: 4, fontSize: 11, padding: "1px 3px" },
    sel: { background: "#181825", color: "#cdd6f4", border: "1px solid #45475a", borderRadius: 4, fontSize: 11 },
    stopBtn: { background: "#f38ba8", border: "none", color: "#11111b", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontWeight: "bold", fontSize: 11 },
    ioBtn: { background: "none", border: "1px solid #45475a", color: "#a6adc8", borderRadius: 5, padding: "3px 6px", cursor: "pointer", fontSize: 11 },
    resetBtn: { background: "none", border: "1px solid #45475a", color: "#f9e2af", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11 },
    chk: { width: 12, height: 12, flex: "0 0 auto", margin: 0 },
    cellRowOff: { opacity: 0.4 },
    main: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 },
    topArea: { display: "flex", flex: "1 1 auto", minHeight: 0 },
    list: { borderRight: "1px solid #313244", overflowY: "auto", flex: "0 0 auto" },
    vsplit: { width: 5, flex: "0 0 auto", cursor: "col-resize", background: "#313244" },
    hsplit: { height: 5, flex: "0 0 auto", cursor: "row-resize", background: "#313244" },
    outputWrap: { display: "flex", flexDirection: "column", flex: "0 0 auto", minHeight: 0 },
    outputHead: { padding: "3px 8px", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: "#89b4fa", background: "#181825", flex: "0 0 auto" },
    empty: { padding: 10, opacity: 0.5 },
    cellRow: { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", cursor: "pointer", borderBottom: "1px solid #26263a" },
    cellRowActive: { background: "#313244" },
    cellRowDrag: { borderTop: "2px solid #89b4fa" },
    grip: { cursor: "grab", opacity: 0.4, flex: "0 0 auto", fontSize: 12, lineHeight: 1 },
    cellName: { flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    dot: (s) => ({ width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto", background: s === "ok" ? "#a6e3a1" : s === "error" ? "#f38ba8" : s === "running" ? "#f9e2af" : "#585b70" }),
    runBtn: { background: "none", border: "none", color: "#89b4fa", cursor: "pointer", fontSize: 12 },
    editorPane: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
    editorHead: { display: "flex", justifyContent: "space-between", padding: "6px 8px", borderBottom: "1px solid #313244" },
    editorTitle: { color: "#89b4fa" },
    textarea: { flex: "1 1 auto", resize: "none", border: "none", outline: "none", background: "#181825", color: "#cdd6f4", fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 8, userSelect: "text" },
    runRow: { padding: "6px 8px", borderTop: "1px solid #313244", flex: "0 0 auto" },
    output: { margin: 0, padding: 8, flex: "1 1 auto", overflow: "auto", background: "#11111b", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" },
    iconBtn: { background: "none", border: "none", color: "#cdd6f4", cursor: "pointer" },
    smallBtn: { background: "#45475a", border: "none", color: "#cdd6f4", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontSize: 11 },
    primaryBtn: { background: "#89b4fa", border: "none", color: "#11111b", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontWeight: "bold" },
    linkBtn: { background: "none", border: "none", color: "#f38ba8", cursor: "pointer", fontSize: 11, marginLeft: 6 },
    mini: { position: "fixed", top: 20, right: 20, zIndex: 2147483647, border: "none", borderRadius: "50%", width: 38, height: 38, cursor: "pointer", background: "#313244", color: "#fff", fontSize: 16 },
    resizeHandle: { position: "absolute", right: 0, bottom: 0, width: 14, height: 14, cursor: "nwse-resize", background: "linear-gradient(135deg, transparent 50%, #89b4fa 50%)" }
  };
  function App() {
    const [cells, setCells] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [statuses, setStatuses] = useState({});
    const [outputs, setOutputs] = useState({});
    const [resumeId, setResumeId] = useState(null);
    const [running, setRunning] = useState(false);
    const [loop, setLoop] = useState(false);
    const [delay, setDelay] = useState(500);
    const [maxIter, setMaxIter] = useState(100);
    const [onError, setOnError] = useState("stop");
    const [dragOverId, setDragOverId] = useState(null);
    const [visible, setVisible] = useState(true);
    const [pos, setPos] = useState({ x: 20, y: 20, w: 420, h: 480, listW: 130, outH: 130 });
    const [miniPos, setMiniPos] = useState({ x: 20, y: 80 });
    const [loaded, setLoaded] = useState(false);
    const dragState = useRef(null);
    const resizeState = useRef(null);
    const miniDrag = useRef(null);
    const saveTimer = useRef(null);
    const stopRef = useRef(false);
    const cellsRef = useRef([]);
    const dragIdRef = useRef(null);
    useEffect(() => {
      (async () => {
        const nb = await loadNotebook();
        setCells(nb.cells);
        if (nb.cells[0]) setSelectedId(nb.cells[0].id);
        const savedPos = await gmGet(KEY_PANELPOS, null);
        if (savedPos) setPos((p2) => ({ ...p2, ...savedPos }));
        const savedMini = await gmGet(KEY_MINIPOS, null);
        if (savedMini) setMiniPos(savedMini);
        const cp = await checkpoint.restore();
        if (cp && cp.lastSuccessCellId) setResumeId(cp.lastSuccessCellId);
        for (const c of nb.cells.filter((x) => x.kind === "setup")) {
          setStatuses((s) => ({ ...s, [c.id]: "running" }));
          const res = await runCell(c);
          setStatuses((s) => ({ ...s, [c.id]: res.ok ? "ok" : "error" }));
          setOutputs((o) => ({ ...o, [c.id]: res.output }));
        }
        setLoaded(true);
      })();
    }, []);
    useEffect(() => {
      if (loaded) gmSet(KEY_PANELPOS, pos);
    }, [pos, loaded]);
    useEffect(() => {
      if (loaded) gmSet(KEY_MINIPOS, miniPos);
    }, [miniPos, loaded]);
    useEffect(() => {
      cellsRef.current = cells;
    }, [cells]);
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
        kind
      };
      mutateCells((prev) => [...prev, cell]);
      setSelectedId(cell.id);
    }
    function updateSource(id, source) {
      mutateCells((prev) => prev.map((c) => c.id === id ? { ...c, source } : c));
    }
    function renameCell(id) {
      const name = prompt("Cell name:");
      if (name == null) return;
      mutateCells((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    }
    function deleteCell(id) {
      mutateCells((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
    async function doRun(cell) {
      setStatuses((s) => ({ ...s, [cell.id]: "running" }));
      const res = await runCell(cell);
      setStatuses((s) => ({ ...s, [cell.id]: res.ok ? "ok" : "error" }));
      setOutputs((o) => ({ ...o, [cell.id]: res.output }));
      if (res.ok && cell.kind === "step") setResumeId(cell.id);
      return res;
    }
    function toggleEnabled(id) {
      mutateCells(
        (prev) => prev.map((c) => c.id === id ? { ...c, enabled: c.enabled === false } : c)
      );
    }
    function moveCell(dragId, targetId) {
      if (!dragId || dragId === targetId) return;
      mutateCells((prev) => {
        const from = prev.findIndex((c) => c.id === dragId);
        const to = prev.findIndex((c) => c.id === targetId);
        if (from < 0 || to < 0) return prev;
        const next = prev.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    }
    function stopRun() {
      stopRef.current = true;
    }
    async function runSequence() {
      if (running) return;
      stopRef.current = false;
      setRunning(true);
      const maxN = Number(maxIter) || 0;
      const wait = Math.max(0, Number(delay) || 0);
      try {
        let iter = 0;
        do {
          iter++;
          const steps = cellsRef.current.filter(
            (c) => c.kind === "step" && c.enabled !== false
          );
          for (const c of steps) {
            if (stopRef.current) return;
            const res = await doRun(c);
            if (!res.ok) {
              if (onError === "reload") {
                location.reload();
                return;
              }
              if (onError === "stop") return;
            }
          }
          if (loop && !stopRef.current && wait) await sleep(wait);
        } while (loop && !stopRef.current && (maxN <= 0 || iter < maxN));
      } finally {
        setRunning(false);
        stopRef.current = false;
      }
    }
    async function resetCtx() {
      if (!confirm("Clear ctx (data/refs/lib) + delete checkpoint?")) return;
      for (const k in ctx.data) delete ctx.data[k];
      for (const k in ctx.refs) delete ctx.refs[k];
      for (const k in ctx.lib) delete ctx.lib[k];
      await checkpoint.clear();
      setResumeId(null);
      for (const c of cellsRef.current.filter((x) => x.kind === "setup")) {
        await doRun(c);
      }
    }
    function exportJSON() {
      const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      download(
        `nb-${host}-${ts}.json`,
        JSON.stringify({ version: 1, host, cells }, null, 2),
        "application/json"
      );
    }
    function exportMarkdown() {
      const ts = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      download(`nb-${host}-${ts}.md`, buildMarkdown(cells), "text/markdown");
    }
    function importFile() {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".json,.md,.txt,.markdown";
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = String(reader.result);
            const isJson = file.name.endsWith(".json") || text.trim().startsWith("{");
            let imported = isJson ? parseNotebookJSON(text) : parseMarkdown(text);
            if (!imported.length) {
              alert("No cells parsed.");
              return;
            }
            const replace = confirm(
              `Import ${imported.length} cells.

OK = REPLACE all cells
Cancel = APPEND to the end`
            );
            mutateCells((prev) => replace ? imported : [...prev, ...imported]);
            setSelectedId(imported[0].id);
          } catch (e) {
            alert("Import failed: " + e.message);
          }
        };
        reader.readAsText(file);
      };
      inp.click();
    }
    const onMiniDown = (e) => {
      miniDrag.current = { sx: e.clientX, sy: e.clientY, ox: miniPos.x, oy: miniPos.y, moved: false };
      const move = (ev) => {
        const d = miniDrag.current;
        if (!d) return;
        if (Math.abs(ev.clientX - d.sx) > 3 || Math.abs(ev.clientY - d.sy) > 3) d.moved = true;
        setMiniPos({ x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy });
      };
      const up = () => {
        const d = miniDrag.current;
        miniDrag.current = null;
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (d && !d.moved) setVisible(true);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    if (!visible) {
      const miniStyle = { ...st.mini, left: miniPos.x + "px", top: miniPos.y + "px", right: "auto" };
      return html`<button onMouseDown=${onMiniDown} style=${miniStyle} title="click: open · drag: move">🧪</button>`;
    }
    const onDragStart = (e) => {
      dragState.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
      const move = (ev) => {
        const d = dragState.current;
        if (!d) return;
        setPos((p2) => ({ ...p2, x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy }));
      };
      const up = () => {
        dragState.current = null;
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const onResizeStart = (e) => {
      e.stopPropagation();
      resizeState.current = { sx: e.clientX, sy: e.clientY, ow: pos.w, oh: pos.h };
      const move = (ev) => {
        const r = resizeState.current;
        if (!r) return;
        setPos((p2) => ({
          ...p2,
          w: Math.max(300, r.ow + ev.clientX - r.sx),
          h: Math.max(240, r.oh + ev.clientY - r.sy)
        }));
      };
      const up = () => {
        resizeState.current = null;
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const onListResizeStart = (e) => {
      e.stopPropagation();
      const sx = e.clientX, ow = pos.listW;
      const move = (ev) => setPos((p2) => ({ ...p2, listW: Math.max(90, Math.min(p2.w - 140, ow + ev.clientX - sx)) }));
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const onOutResizeStart = (e) => {
      e.stopPropagation();
      const sy = e.clientY, oh = pos.outH;
      const move = (ev) => setPos((p2) => ({ ...p2, outH: Math.max(36, Math.min(p2.h - 180, oh - (ev.clientY - sy))) }));
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const selected = cells.find((c) => c.id === selectedId) || null;
    const panelStyle = { ...st.panel, left: pos.x + "px", top: pos.y + "px", width: pos.w + "px", height: pos.h + "px" };
    return html`
    <div style=${panelStyle}>
      <div style=${st.header} onMouseDown=${onDragStart}>
        <span>🧪 nb-steprunner <small style=${st.host}>${host}</small></span>
        <button onClick=${() => setVisible(false)} style=${st.iconBtn}>✕</button>
      </div>

      <div style=${st.toolbar}>
        <button style=${st.smallBtn} onClick=${() => addCell("step")}>+ Cell</button>
        <button style=${st.smallBtn} onClick=${() => addCell("setup")}>+ Setup</button>
        <button style=${st.smallBtn} onClick=${() => addCell("probe")}>+ Probe</button>
        ${resumeId && html`<span style=${st.resume}>resume from: ${(cells.find((c) => c.id === resumeId) || {}).name || "?"}</span>`}
      </div>

      <div style=${st.controls}>
        ${running ? html`<button style=${st.stopBtn} onClick=${stopRun}>■ Stop</button>` : html`<button style=${st.smallBtn} onClick=${runSequence}>▶▶ Run All</button>`}
        <label style=${st.ctrlLabel}>
          <input type="checkbox" checked=${loop} onChange=${(e) => setLoop(e.target.checked)} /> loop
        </label>
        <label style=${st.ctrlLabel}>delay
          <input style=${st.numIn} type="number" value=${delay} onInput=${(e) => setDelay(e.target.value)} />ms
        </label>
        <label style=${st.ctrlLabel}>max
          <input style=${st.numIn} type="number" value=${maxIter} onInput=${(e) => setMaxIter(e.target.value)} />
        </label>
        <select style=${st.sel} value=${onError} onChange=${(e) => setOnError(e.target.value)}>
          <option value="stop">on-error: stop</option>
          <option value="continue">on-error: continue</option>
          <option value="reload">on-error: reload</option>
        </select>
        <button style=${{ ...st.ioBtn, marginLeft: "auto" }} onClick=${exportJSON} title="Export JSON (backup)">⇩json</button>
        <button style=${st.ioBtn} onClick=${exportMarkdown} title="Export Markdown (Obsidian)">⇩md</button>
        <button style=${st.ioBtn} onClick=${importFile} title="Import JSON / Markdown">⇧import</button>
        <button style=${st.resetBtn} onClick=${resetCtx}>reset ctx</button>
      </div>

      <div style=${st.main}>
        <div style=${st.topArea}>
          <div style=${{ ...st.list, width: pos.listW + "px" }}>
            ${cells.length === 0 && html`<div style=${st.empty}>No cells yet. Click + Cell.</div>`}
            ${cells.map((c) => html`
              <div key=${c.id}
                   draggable=${true}
                   onDragStart=${(e) => {
    dragIdRef.current = c.id;
    e.dataTransfer.effectAllowed = "move";
  }}
                   onDragOver=${(e) => {
    e.preventDefault();
    if (dragOverId !== c.id) setDragOverId(c.id);
  }}
                   onDragLeave=${() => {
    if (dragOverId === c.id) setDragOverId(null);
  }}
                   onDrop=${(e) => {
    e.preventDefault();
    moveCell(dragIdRef.current, c.id);
    setDragOverId(null);
    dragIdRef.current = null;
  }}
                   onDragEnd=${() => {
    setDragOverId(null);
    dragIdRef.current = null;
  }}
                   style=${{ ...st.cellRow, ...c.id === selectedId ? st.cellRowActive : {}, ...c.kind === "step" && c.enabled === false ? st.cellRowOff : {}, ...dragOverId === c.id ? st.cellRowDrag : {} }}
                   onClick=${() => setSelectedId(c.id)}>
                <span style=${st.grip} title="drag to reorder">⠿</span>
                ${c.kind === "step" ? html`<input type="checkbox" title="include in Run All" style=${st.chk}
                      checked=${c.enabled !== false}
                      onClick=${(e) => {
    e.stopPropagation();
    toggleEnabled(c.id);
  }} />` : html`<span style=${st.chk}></span>`}
                <span style=${st.dot(statuses[c.id])}></span>
                <span style=${st.cellName}>${c.name}${c.kind !== "step" ? " ·" + c.kind : ""}</span>
                <button style=${st.runBtn} onClick=${(e) => {
    e.stopPropagation();
    doRun(c);
  }}>▶</button>
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
                  <button style=${st.linkBtn} onClick=${() => deleteCell(selected.id)}>delete</button>
                </span>
              </div>
              <textarea style=${st.textarea} spellcheck=${false}
                value=${selected.source}
                onInput=${(e) => updateSource(selected.id, e.target.value)}
                onKeyDown=${(e) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      doRun(selected);
    }
  }}
              ></textarea>
              <div style=${st.runRow}>
                <button style=${st.primaryBtn} onClick=${() => doRun(selected)}>▶ Run (Ctrl+Enter)</button>
              </div>
            ` : html`<div style=${st.empty}>Select or add a cell.</div>`}
          </div>
        </div>

        <div style=${st.hsplit} onMouseDown=${onOutResizeStart}></div>

        <div style=${{ ...st.outputWrap, height: pos.outH + "px" }}>
          <div style=${st.outputHead}>output${selected ? " — " + selected.name : ""}</div>
          <pre style=${st.output}>${selected ? outputs[selected.id] || "" : ""}</pre>
        </div>
      </div>

      <div style=${st.resizeHandle} onMouseDown=${onResizeStart}></div>
    </div>
  `;
  }
  function mount() {
    const hostEl = document.createElement("div");
    hostEl.id = "nb-steprunner-host";
    const shadow = hostEl.attachShadow({ mode: "open" });
    document.body.appendChild(hostEl);
    render(html`<${App} />`, shadow);
  }
  mount();

})();