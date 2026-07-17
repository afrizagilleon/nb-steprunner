// ==UserScript==
// @name         nb-steprunner — blob-module kernel probe
// @version      1.0
// @description  Konfirmasi pola kernel final: source cell -> blob module (export default fn(api)) -> jalankan dgn ctx+helper+DOM
// @match        https://GANTI-SITUS-TARGET-ANDA/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

/*
 * Ini mereplikasi persis cara kernel akan meng-compile & menjalankan cell:
 *   1. source cell (string) dibungkus jadi module: `export default async (api) => { <source> }`
 *   2. dibuat Blob URL -> import() -> ambil default export
 *   3. dipanggil dengan objek `api` (ctx + helper) yang dibuat di sandbox
 *
 * Yang diuji:
 *   - operan objek sandbox -> fungsi module (lintas realm)
 *   - akses DOM HALAMAN dari dalam module (document.title, querySelectorAll)
 *   - tulis ke ctx.data dari dalam cell, terbaca lagi di luar
 *   - await di dalam cell
 *
 * Laporkan baris [nb-kernel] ke saya.
 */

(async () => {
  const log = (...a) => console.log('[nb-kernel]', ...a);

  // --- api: dibuat di realm sandbox, dioper ke module realm-halaman ---
  const ctx = { data: {}, refs: {} };
  const api = {
    ctx,
    $: (sel, root = document) => root.querySelector(sel),
    $$: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    print: (...a) => log('  (print)', ...a),
  };

  // --- ini yang akan diketik user di panel sebagai isi cell ---
  const cellSource = `
    api.print('judul halaman =', document.title);
    const totalEl = api.$$('*').length;      // DOM halaman asli?
    api.ctx.data.total = totalEl;
    await api.sleep(50);
    return totalEl;
  `;

  // --- compile: bungkus jadi module, jadikan blob, import ---
  const moduleCode =
    `export default async (api) => {\n${cellSource}\n};\n//# sourceURL=nb-cell-probe.js`;

  try {
    const url = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
    const mod = await import(/* webpackIgnore: true */ url);
    URL.revokeObjectURL(url);

    const result = await mod.default(api);

    const domOk = typeof result === 'number' && result > 10; // page nyata pasti > 10 elemen
    log(domOk ? '✅ SEMUA OK' : '⚠️ jalan tapi DOM mencurigakan',
        '| return =', result, '| ctx.data =', JSON.stringify(ctx.data));
  } catch (e) {
    log('❌ GAGAL:', e.message);
  }
})();
