// Cross-frame access, child-frame side.
//
// When Tampermonkey injects the userscript into an iframe (no @noframes, and the frame's
// URL is covered by @match), this agent is what runs there instead of the panel UI.
// It has no interface: it waits for code from the top frame, executes it against the
// frame's own document, and posts the result back.

import { compileModule } from './compile';
import { FRAME_HEADER } from './constants';
import { $, $$, sleep, waitFor, print, printStack } from './helpers';
import { NB_FRAME, isFrameMsg, toTransferable, type FrameRes } from './frame-rpc';

function reply(target: Window, res: FrameRes) {
  target.postMessage(res, '*');
}

export function startFrameAgent() {
  window.addEventListener('message', async (e: MessageEvent) => {
    const d = e.data;
    if (!isFrameMsg(d)) return;

    // Only our own top frame may drive this agent. Without this check any script on any
    // page embedding us could execute arbitrary code in this document.
    if (e.source !== window.top) return;

    if (d.kind === 'ping') {
      (e.source as Window).postMessage({ __nb: NB_FRAME, kind: 'hello' }, '*');
      return;
    }
    if (d.kind !== 'req') return;

    const source = e.source as Window;
    const output: string[] = [];
    printStack.push((line) => output.push(line));
    try {
      const fn = await compileModule(d.body, FRAME_HEADER, 'nb-frame-remote');
      const value = await fn({
        doc: document,
        win: window,
        args: d.args,
        $,
        $$,
        sleep,
        waitFor,
        print,
      });
      reply(source, {
        __nb: NB_FRAME,
        kind: 'res',
        id: d.id,
        ok: true,
        value: toTransferable(value),
        output,
      });
    } catch (err: any) {
      reply(source, {
        __nb: NB_FRAME,
        kind: 'res',
        id: d.id,
        ok: false,
        error: String(err && err.stack ? err.stack : err),
        output,
      });
    } finally {
      printStack.pop();
    }
  });

  // Announce ourselves — the top frame may already be waiting on frames.ready().
  try {
    if (window.top) window.top.postMessage({ __nb: NB_FRAME, kind: 'hello' }, '*');
  } catch (_) {
    /* ignore */
  }
  console.log('[nb] frame agent ready:', location.href);
}
