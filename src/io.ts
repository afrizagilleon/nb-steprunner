import { uid } from './util';
import { VALID_KINDS } from './constants';
import type { Cell } from './types';

export function normalizeCell(c: any): Cell {
  return {
    id: c.id || uid(),
    name: (c.name || 'cell').toString(),
    source: (c.source != null ? c.source : '').toString(),
    kind: VALID_KINDS.includes(c.kind) ? c.kind : 'step',
    enabled: c.enabled !== false,
  };
}

// Trigger unduhan file dari string (anchor sementara di light DOM).
export function download(filename: string, text: string, type?: string) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseNotebookJSON(text: string): Cell[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data.cells) ? data.cells : [];
  return arr.map(normalizeCell);
}

// Markdown round-trip: heading = nama, komentar meta = kind/enabled, fence js = source.
export function buildMarkdown(cells: Cell[]): string {
  return cells
    .map((c) => {
      const meta = `<!-- nb:kind=${c.kind} enabled=${c.enabled !== false} -->`;
      return `### ${c.name}\n${meta}\n\`\`\`js\n${c.source}\n\`\`\`\n`;
    })
    .join('\n');
}

export function parseMarkdown(md: string): Cell[] {
  const cells: Cell[] = [];
  const re =
    /^#{1,6}[ \t]+(.+?)[ \t]*\r?\n(?:<!--\s*nb:([^>]*?)-->\r?\n)?```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const meta = m[2] || '';
    const kind = (/kind=(\w+)/.exec(meta) || [])[1];
    const enabled = (/enabled=(\w+)/.exec(meta) || [])[1];
    cells.push(
      normalizeCell({
        name: m[1].trim(),
        source: m[3],
        kind,
        enabled: enabled !== 'false',
      })
    );
  }
  return cells;
}
