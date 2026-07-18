import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentWithTab } from '@codemirror/commands';

export interface EditorHandle {
  view: EditorView;
  getDoc: () => string;
  destroy: () => void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (doc: string) => void;
  onRun: () => void;
}

// Create a CodeMirror 6 editor. Tab indents (not focus-move); Ctrl/Cmd+Enter runs the cell.
export function createEditor(opts: EditorOptions): EditorHandle {
  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        // High precedence so Tab / Mod-Enter win over any default bindings.
        Prec.highest(
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: () => {
                opts.onRun();
                return true;
              },
            },
          ])
        ),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    }),
  });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
