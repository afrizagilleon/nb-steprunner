import { html, render } from './preact';
import { App } from './ui/App';

function mount() {
  const hostEl = document.createElement('div');
  hostEl.id = 'nb-steprunner-host';

  // Keep the host page's global keyboard shortcuts from hijacking keys typed in our
  // panel/editor. Events from the Shadow DOM are retargeted to the host element, so the
  // page's `keydown` handler sees a plain <div> (not an editable) and fires its shortcut
  // (often with preventDefault, which also swallows the character). CodeMirror handles the
  // key inside the shadow tree first; here we stop the event before it reaches the page's
  // document/window listeners. We only stop propagation — never the default action — so
  // typing and CodeMirror keybindings keep working.
  const stop = (e: Event) => e.stopPropagation();
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    hostEl.addEventListener(type, stop);
  }

  const shadow = hostEl.attachShadow({ mode: 'open' });
  document.body.appendChild(hostEl);
  render(html`<${App} />`, shadow);
}

mount();
