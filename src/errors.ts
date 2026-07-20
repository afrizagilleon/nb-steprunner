// Cell error formatting. Kept free of DOM/GM dependencies so it can be tested directly.

// compile() wraps the cell source in 2 lines before the user's code (the `async (api) =>`
// line and the injected CELL_HEADER), so a stack line points 2 higher than the real one.
export const HEADER_LINES = 2;

/** Rewrite `nb-cell-*.js:LINE:COL` / `nb-frame-*.js:LINE:COL` back to the line the user wrote. */
export function remapLines(text: string): string {
  return text.replace(
    /(nb-(?:cell|frame)[^\s:)]*\.js):(\d+):(\d+)/g,
    (_m, file, line, col) => `${file}:${Math.max(1, Number(line) - HEADER_LINES)}:${col}`
  );
}

/**
 * Render an error the way a person can act on it: name + message first, then only the
 * frames from the user's own cell, then the offending source line.
 *
 * The headline is built from err.name/err.message rather than taken from err.stack —
 * V8 prefixes the stack with "Name: message" but Firefox/Safari do not, and relying on
 * the stack silently drops the message on those engines.
 */
export function formatError(err: any, source: string): string {
  const name = (err && err.name) || 'Error';
  const msg = err && err.message != null ? err.message : String(err);
  const head = `✖ ${name}: ${msg}`;

  const raw = err && err.stack ? remapLines(String(err.stack)) : '';
  if (!raw) return head;

  let lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length && lines[0].startsWith(name + ':')) lines = lines.slice(1); // V8 duplicate

  // Engine and extension internals are noise; keep the frames inside the user's own code.
  const own = lines.filter((l) => /nb-(?:cell|frame)[^\s:)]*\.js:/.test(l));
  const shown = (own.length ? own : lines.slice(0, 3)).map((l) => '  ' + l.trim());

  // Quote the offending source line — the fastest way to see what actually broke.
  const hit = /nb-cell[^\s:)]*\.js:(\d+):/.exec(own[0] || '');
  const srcLine = hit ? source.split('\n')[Number(hit[1]) - 1] : undefined;
  const quoted = srcLine != null ? `\n  ${hit![1]} | ${srcLine}` : '';

  return head + '\n' + shown.join('\n') + quoted;
}
