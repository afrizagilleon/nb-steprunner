// ==UserScript==
// @name         Preact Counter Widget
// @version      1.0
// @author       Afriza
// @description  Contoh UI Preact + htm langsung di userscript, isolasi Shadow DOM
// @match        https://preactjs.com/*
// @noframes
// @icon         https://www.google.com/s2/favicons?sz=64&domain=preactjs.com
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/dist/preact.umd.js
// @require      https://cdn.jsdelivr.net/npm/preact@10.23.1/hooks/dist/hooks.umd.js
// @require      https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js
// @run-at       document-idle
// ==/UserScript==

const { h, render } = window.preact;
const { useState, useEffect, useRef } = window.preactHooks;
const html = window.htm.bind(h);

const STORAGE_KEY = 'preact_widget_count';
const POS_KEY = 'preact_widget_pos';

function App() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const [pos, setPos] = useState({ x: 20, y: 20, w: 220, h: 160 });
  const panelRef = useRef(null);
  const dragState = useRef(null);
  const resizeState = useRef(null);

  useEffect(() => {
    GM_getValue(STORAGE_KEY, 0).then((v) => setCount(v));
    GM_getValue(POS_KEY, null).then((v) => { if (v) setPos(v); });
  }, []);

  useEffect(() => { GM_setValue(STORAGE_KEY, count); }, [count]);
  useEffect(() => { GM_setValue(POS_KEY, pos); }, [pos]);

  function onDragStart(e) {
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e) {
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPos((p) => ({ ...p, x: d.origX + dx, y: d.origY + dy }));
  }
  function onDragEnd() {
    dragState.current = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  function onResizeStart(e) {
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startY: e.clientY, origW: pos.w, origH: pos.h };
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }
  function onResizeMove(e) {
    const r = resizeState.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    setPos((p) => ({
      ...p,
      w: Math.max(160, r.origW + dx),
      h: Math.max(100, r.origH + dy),
    }));
  }
  function onResizeEnd() {
    resizeState.current = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  if (!visible) {
    return html`
      <button onClick=${() => setVisible(true)} style=${btnMiniStyle}>🧩</button>
    `;
  }

  const dynamicPanelStyle = {
    ...panelStyle,
    left: pos.x + 'px',
    top: pos.y + 'px',
    width: pos.w + 'px',
    height: pos.h + 'px',
  };

  return html`
    <div ref=${panelRef} style=${dynamicPanelStyle}>
      <div style=${headerStyle} onMouseDown=${onDragStart}>
        <span>Preact Widget</span>
        <button onClick=${() => setVisible(false)} style=${closeStyle}>✕</button>
      </div>
      <div style=${bodyStyle}>
        <p>Elemen di halaman: <b>${document.querySelectorAll('*').length}</b></p>
        <p>Counter: <b>${count}</b></p>
        <button onClick=${() => setCount(count + 1)}>+1</button>
        <button onClick=${() => setCount(0)}>Reset</button>
      </div>
      <div style=${resizeHandleStyle} onMouseDown=${onResizeStart}></div>
    </div>
  `;
}

const panelStyle = { position: 'fixed', background: '#1e1e2e', color: '#fff', borderRadius: '10px', fontFamily: 'sans-serif', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,.3)', zIndex: 999999, overflow: 'hidden', userSelect: 'none' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#313244', borderRadius: '10px 10px 0 0', cursor: 'move' };
const bodyStyle = { padding: '10px' };
const closeStyle = { background: 'none', border: 'none', color: '#fff', cursor: 'pointer' };
const btnMiniStyle = { position: 'fixed', top: '20px', right: '20px', zIndex: 999999, border: 'none', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer' };
const resizeHandleStyle = { position: 'absolute', right: '0', bottom: '0', width: '14px', height: '14px', cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, #89b4fa 50%)' };

function mount() {
  const host = document.createElement('div');
  host.id = 'preact-widget-host';
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  render(html`<${App} />`, shadow);
}

mount();
