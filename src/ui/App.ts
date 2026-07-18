import { html, useState, useEffect, useRef, useCallback } from '../preact';
import {
  host,
  gmGet,
  gmSet,
  KEY_PANELPOS,
  KEY_MINIPOS,
  loadNotebook,
  saveNotebook,
} from '../storage';
import { uid } from '../util';
import { DEFAULT_SOURCE } from '../constants';
import { download, buildMarkdown, parseNotebookJSON, parseMarkdown } from '../io';
import { runCell } from '../kernel';
import { checkpoint } from '../checkpoint';
import { ctx } from '../ctx';
import { sleep } from '../helpers';
import { st } from './styles';
import { createEditor, type EditorHandle } from './editor';
import type { Cell } from '../types';

export function App() {
  const [cells, setCells] = useState([] as Cell[]);
  const [selectedId, setSelectedId] = useState(null as string | null);
  const [statuses, setStatuses] = useState({} as Record<string, string>); // id -> 'idle'|'running'|'ok'|'error'
  const [outputs, setOutputs] = useState({} as Record<string, string>); // id -> text
  const [resumeId, setResumeId] = useState(null as string | null);
  const [running, setRunning] = useState(false);
  const [loop, setLoop] = useState(false);
  const [delay, setDelay] = useState(500 as any);
  const [maxIter, setMaxIter] = useState(100 as any);
  const [onError, setOnError] = useState('stop'); // 'stop' | 'continue' | 'reload'
  const [dragOverId, setDragOverId] = useState(null as string | null);
  const [visible, setVisible] = useState(true);
  const [pos, setPos] = useState({ x: 20, y: 20, w: 420, h: 480, listW: 130, outH: 130 } as any);
  const [miniPos, setMiniPos] = useState({ x: 20, y: 80 } as any);
  const [loaded, setLoaded] = useState(false);

  const dragState = useRef(null);
  const resizeState = useRef(null);
  const miniDrag = useRef(null);
  const saveTimer = useRef(null);
  const stopRef = useRef(false);
  const cellsRef = useRef([] as Cell[]); // latest cells to read inside the loop
  const dragIdRef = useRef(null as string | null); // id of the cell being dragged
  const editorHostRef = useRef(null as HTMLElement | null); // CodeMirror mount point
  const editorRef = useRef(null as EditorHandle | null); // live CodeMirror handle
  const updateSourceRef = useRef((_id: string, _src: string) => {}); // latest updateSource
  const runCurrentRef = useRef(() => {}); // run the currently edited cell (latest source)

  // ---- initial load: notebook + position + restore checkpoint ----
  useEffect(() => {
    (async () => {
      const nb = await loadNotebook();
      setCells(nb.cells);
      if (nb.cells[0]) setSelectedId(nb.cells[0].id);
      const savedPos = await gmGet(KEY_PANELPOS, null);
      if (savedPos) setPos((p: any) => ({ ...p, ...savedPos }));
      const savedMini = await gmGet(KEY_MINIPOS, null);
      if (savedMini) setMiniPos(savedMini);
      const cp = await checkpoint.restore();
      if (cp && cp.lastSuccessCellId) setResumeId(cp.lastSuccessCellId);
      // Auto-run 'setup' cells (e.g. lib definitions) — does not advance the resume point.
      for (const c of nb.cells.filter((x) => x.kind === 'setup')) {
        setStatuses((s) => ({ ...s, [c.id]: 'running' }));
        const res = await runCell(c);
        setStatuses((s) => ({ ...s, [c.id]: res.ok ? 'ok' : 'error' }));
        setOutputs((o) => ({ ...o, [c.id]: res.output }));
      }
      setLoaded(true);
    })();
  }, []);

  // ---- persist position ----
  useEffect(() => {
    if (loaded) gmSet(KEY_PANELPOS, pos);
  }, [pos, loaded]);

  useEffect(() => {
    if (loaded) gmSet(KEY_MINIPOS, miniPos);
  }, [miniPos, loaded]);

  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  // ---- CodeMirror lifecycle: (re)create the editor when the selected cell changes ----
  useEffect(() => {
    const hostEl = editorHostRef.current;
    if (!hostEl || !selectedId) return;
    const cell = cellsRef.current.find((c) => c.id === selectedId);
    const handle = createEditor({
      parent: hostEl,
      doc: cell ? cell.source : '',
      onChange: (doc) => updateSourceRef.current(selectedId, doc),
      onRun: () => runCurrentRef.current(),
    });
    editorRef.current = handle;
    return () => {
      handle.destroy();
      editorRef.current = null;
    };
  }, [selectedId]);

  // ---- persist notebook (debounced) ----
  const persistCells = useCallback((next: Cell[]) => {
    clearTimeout(saveTimer.current as any);
    saveTimer.current = setTimeout(() => {
      saveNotebook({ version: 1, cells: next });
    }, 400) as any;
  }, []);

  function mutateCells(updater: (prev: Cell[]) => Cell[]) {
    setCells((prev) => {
      const next = updater(prev);
      persistCells(next);
      return next;
    });
  }

  function addCell(kind: string) {
    const cell: Cell = {
      id: uid(),
      name: kind,
      source: DEFAULT_SOURCE[kind] || DEFAULT_SOURCE.step,
      kind: kind as any,
    };
    mutateCells((prev) => [...prev, cell]);
    setSelectedId(cell.id);
  }

  function updateSource(id: string, source: string) {
    mutateCells((prev) => prev.map((c) => (c.id === id ? { ...c, source } : c)));
  }
  function renameCell(id: string) {
    const name = prompt('Cell name:');
    if (name == null) return;
    mutateCells((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }
  function deleteCell(id: string) {
    mutateCells((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function doRun(cell: Cell) {
    setStatuses((s) => ({ ...s, [cell.id]: 'running' }));
    const res = await runCell(cell);
    setStatuses((s) => ({ ...s, [cell.id]: res.ok ? 'ok' : 'error' }));
    setOutputs((o) => ({ ...o, [cell.id]: res.output }));
    if (res.ok && cell.kind === 'step') setResumeId(cell.id);
    return res;
  }

  function toggleEnabled(id: string) {
    mutateCells((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: c.enabled === false } : c))
    );
  }

  // Reorder: move the dragged cell to the target cell's position.
  function moveCell(dragId: string | null, targetId: string) {
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

  // Run All: run enabled 'step' cells, top to bottom. Loop + on-error options.
  // setup/probe/excluded are skipped. Can always be halted via Stop.
  async function runSequence() {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    const maxN = Number(maxIter) || 0; // <= 0 -> unlimited
    const wait = Math.max(0, Number(delay) || 0);
    try {
      let iter = 0;
      do {
        iter++;
        const steps = cellsRef.current.filter(
          (c) => c.kind === 'step' && c.enabled !== false
        );
        for (const c of steps) {
          if (stopRef.current) return;
          const res = await doRun(c);
          if (!res.ok) {
            if (onError === 'reload') {
              location.reload();
              return;
            }
            if (onError === 'stop') return;
            // 'continue' -> go to the next cell
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
    if (!confirm('Clear ctx (data/refs/lib) + delete checkpoint?')) return;
    for (const k in ctx.data) delete ctx.data[k];
    for (const k in ctx.refs) delete ctx.refs[k];
    for (const k in ctx.lib) delete ctx.lib[k];
    await checkpoint.clear();
    setResumeId(null);
    // Rebuild lib from setup cells.
    for (const c of cellsRef.current.filter((x) => x.kind === 'setup')) {
      await doRun(c);
    }
  }

  // ---- Import / Export ----
  function exportJSON() {
    const ts = new Date().toISOString().slice(0, 10);
    download(
      `nb-${host}-${ts}.json`,
      JSON.stringify({ version: 1, host, cells }, null, 2),
      'application/json'
    );
  }
  function exportMarkdown() {
    const ts = new Date().toISOString().slice(0, 10);
    download(`nb-${host}-${ts}.md`, buildMarkdown(cells), 'text/markdown');
  }
  function importFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.md,.txt,.markdown';
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result);
          const isJson = file.name.endsWith('.json') || text.trim().startsWith('{');
          let imported = isJson ? parseNotebookJSON(text) : parseMarkdown(text);
          if (!imported.length) {
            alert('No cells parsed.');
            return;
          }
          const replace = confirm(
            `Import ${imported.length} cells.\n\nOK = REPLACE all cells\nCancel = APPEND to the end`
          );
          mutateCells((prev) => (replace ? imported : [...prev, ...imported]));
          setSelectedId(imported[0].id);
        } catch (e: any) {
          alert('Import failed: ' + e.message);
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  }

  // Minimized button: can be DRAGGED so it is not covered by the page UI.
  // Click (without dragging) = open the panel. Drag >3px = move, does not open.
  const onMiniDown = (e: any) => {
    miniDrag.current = { sx: e.clientX, sy: e.clientY, ox: miniPos.x, oy: miniPos.y, moved: false } as any;
    const move = (ev: any) => {
      const d: any = miniDrag.current;
      if (!d) return;
      if (Math.abs(ev.clientX - d.sx) > 3 || Math.abs(ev.clientY - d.sy) > 3) d.moved = true;
      setMiniPos({ x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy });
    };
    const up = () => {
      const d: any = miniDrag.current;
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
    return html`<button onMouseDown=${onMiniDown} style=${miniStyle} title="click: open · drag: move">🧪</button>`;
  }

  // ---- drag / resize (from nb-preact.js) ----
  const onDragStart = (e: any) => {
    dragState.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y } as any;
    const move = (ev: any) => {
      const d: any = dragState.current;
      if (!d) return;
      setPos((p: any) => ({ ...p, x: d.ox + ev.clientX - d.sx, y: d.oy + ev.clientY - d.sy }));
    };
    const up = () => {
      dragState.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const onResizeStart = (e: any) => {
    e.stopPropagation();
    resizeState.current = { sx: e.clientX, sy: e.clientY, ow: pos.w, oh: pos.h } as any;
    const move = (ev: any) => {
      const r: any = resizeState.current;
      if (!r) return;
      setPos((p: any) => ({
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

  // Vertical splitter: adjust the width of the cell panel (left).
  const onListResizeStart = (e: any) => {
    e.stopPropagation();
    const sx = e.clientX,
      ow = pos.listW;
    const move = (ev: any) =>
      setPos((p: any) => ({ ...p, listW: Math.max(90, Math.min(p.w - 140, ow + ev.clientX - sx)) }));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // Horizontal splitter: adjust the height of the output area (bottom). Drag up = taller.
  const onOutResizeStart = (e: any) => {
    e.stopPropagation();
    const sy = e.clientY,
      oh = pos.outH;
    const move = (ev: any) =>
      setPos((p: any) => ({ ...p, outH: Math.max(36, Math.min(p.h - 180, oh - (ev.clientY - sy))) }));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const selected = cells.find((c) => c.id === selectedId) || null;

  // Keep the CodeMirror callbacks pointing at the latest state each render.
  updateSourceRef.current = updateSource;
  runCurrentRef.current = () => {
    if (!selected) return;
    const src = editorRef.current ? editorRef.current.getDoc() : selected.source;
    doRun({ ...selected, source: src });
  };

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
        ${resumeId && html`<span style=${st.resume}>resume from: ${(cells.find((c) => c.id === resumeId) || ({} as any)).name || '?'}</span>`}
      </div>

      <div style=${st.controls}>
        ${running
          ? html`<button style=${st.stopBtn} onClick=${stopRun}>■ Stop</button>`
          : html`<button style=${st.smallBtn} onClick=${runSequence}>▶▶ Run All</button>`}
        <label style=${st.ctrlLabel}>
          <input type="checkbox" checked=${loop} onChange=${(e: any) => setLoop(e.target.checked)} /> loop
        </label>
        <label style=${st.ctrlLabel}>delay
          <input style=${st.numIn} type="number" value=${delay} onInput=${(e: any) => setDelay(e.target.value)} />ms
        </label>
        <label style=${st.ctrlLabel}>max
          <input style=${st.numIn} type="number" value=${maxIter} onInput=${(e: any) => setMaxIter(e.target.value)} />
        </label>
        <select style=${st.sel} value=${onError} onChange=${(e: any) => setOnError(e.target.value)}>
          <option value="stop">on-error: stop</option>
          <option value="continue">on-error: continue</option>
          <option value="reload">on-error: reload</option>
        </select>
        <button style=${{ ...st.ioBtn, marginLeft: 'auto' }} onClick=${exportJSON} title="Export JSON (backup)">⇩json</button>
        <button style=${st.ioBtn} onClick=${exportMarkdown} title="Export Markdown (Obsidian)">⇩md</button>
        <button style=${st.ioBtn} onClick=${importFile} title="Import JSON / Markdown">⇧import</button>
        <button style=${st.resetBtn} onClick=${resetCtx}>reset ctx</button>
      </div>

      <div style=${st.main}>
        <div style=${st.topArea}>
          <div style=${{ ...st.list, width: pos.listW + 'px' }}>
            ${cells.length === 0 && html`<div style=${st.empty}>No cells yet. Click + Cell.</div>`}
            ${cells.map((c) => html`
              <div key=${c.id}
                   draggable=${true}
                   onDragStart=${(e: any) => { dragIdRef.current = c.id; e.dataTransfer.effectAllowed = 'move'; }}
                   onDragOver=${(e: any) => { e.preventDefault(); if (dragOverId !== c.id) setDragOverId(c.id); }}
                   onDragLeave=${() => { if (dragOverId === c.id) setDragOverId(null); }}
                   onDrop=${(e: any) => { e.preventDefault(); moveCell(dragIdRef.current, c.id); setDragOverId(null); dragIdRef.current = null; }}
                   onDragEnd=${() => { setDragOverId(null); dragIdRef.current = null; }}
                   style=${{ ...st.cellRow, ...(c.id === selectedId ? st.cellRowActive : {}), ...(c.kind === 'step' && c.enabled === false ? st.cellRowOff : {}), ...(dragOverId === c.id ? st.cellRowDrag : {}) }}
                   onClick=${() => setSelectedId(c.id)}>
                <span style=${st.grip} title="drag to reorder">⠿</span>
                ${c.kind === 'step'
                  ? html`<input type="checkbox" title="include in Run All" style=${st.chk}
                      checked=${c.enabled !== false}
                      onClick=${(e: any) => { e.stopPropagation(); toggleEnabled(c.id); }} />`
                  : html`<span style=${st.chk}></span>`}
                <span style=${st.dot(statuses[c.id])}></span>
                <span style=${st.cellName}>${c.name}${c.kind !== 'step' ? ' ·' + c.kind : ''}</span>
                <button style=${st.runBtn} onClick=${(e: any) => { e.stopPropagation(); doRun(c); }}>▶</button>
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
              <div style=${st.editorHost} ref=${editorHostRef}></div>
              <div style=${st.runRow}>
                <button style=${st.primaryBtn} onClick=${() => runCurrentRef.current()}>▶ Run (Ctrl+Enter)</button>
              </div>
            ` : html`<div style=${st.empty}>Select or add a cell.</div>`}
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
