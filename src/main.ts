import { html, render } from './preact';
import { App } from './ui/App';

function mount() {
  const hostEl = document.createElement('div');
  hostEl.id = 'nb-steprunner-host';
  const shadow = hostEl.attachShadow({ mode: 'open' });
  document.body.appendChild(hostEl);
  render(html`<${App} />`, shadow);
}

mount();
