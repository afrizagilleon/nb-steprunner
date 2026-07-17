// ==UserScript==
// @name         nb-steprunner — CSP strategy probe
// @version      1.0
// @description  Uji beberapa strategi eksekusi kode-dari-string di bawah CSP situs target
// @match        https://GANTI-SITUS-TARGET-ANDA/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addElement
// @run-at       document-idle
// ==/UserScript==

/*
 * Cara pakai:
 *  1. Ganti @match ke situs target Anda (biarkan rahasia, tak perlu beri tahu saya).
 *  2. Pasang di Tampermonkey, buka situsnya, buka DevTools Console.
 *  3. Lihat baris berlabel [nb-csp]. Cukup laporkan ke saya baris mana ✅ / ❌.
 *
 * Catatan: grant GM_* aktif -> skrip berjalan di SANDBOX Tampermonkey, bukan konteks
 * halaman. Ini yang membedakan dari test pertama (@grant none).
 */

(async () => {
  const log = (label, ok, extra) =>
    console.log(`[nb-csp] ${ok ? '✅' : '❌'} ${label}` + (extra ? ` — ${extra}` : ''));

  // --- Strategi 1: new Function di konteks sandbox (grant aktif) ---
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('return 40 + 2');
    const v = await fn();
    log('1. new AsyncFunction (sandbox)', v === 42, `hasil=${v}`);
  } catch (e) {
    log('1. new AsyncFunction (sandbox)', false, e.message);
  }

  // --- Strategi 2: eval langsung ---
  try {
    // eslint-disable-next-line no-eval
    const v = eval('40 + 2');
    log('2. eval()', v === 42, `hasil=${v}`);
  } catch (e) {
    log('2. eval()', false, e.message);
  }

  // --- Strategi 3: dynamic import() dari Blob URL (module, bukan eval) ---
  try {
    const code = 'export default 40 + 2;';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = await import(/* webpackIgnore: true */ url);
    URL.revokeObjectURL(url);
    log('3. import() blob module', mod.default === 42, `hasil=${mod.default}`);
  } catch (e) {
    log('3. import() blob module', false, e.message);
  }

  // --- Strategi 4: GM_addElement <script> dengan textContent ---
  try {
    window.__nbProbe = null;
    if (typeof GM_addElement === 'function') {
      GM_addElement('script', { textContent: 'window.__nbProbe = 40 + 2;' });
      // beri waktu eksekusi
      await new Promise((r) => setTimeout(r, 50));
      log('4. GM_addElement script', window.__nbProbe === 42, `hasil=${window.__nbProbe}`);
    } else {
      log('4. GM_addElement script', false, 'GM_addElement tidak tersedia');
    }
  } catch (e) {
    log('4. GM_addElement script', false, e.message);
  }

  console.log('[nb-csp] --- selesai. Laporkan baris mana yang ✅ ---');
})();
