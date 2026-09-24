// Browser code, bundled by esbuild into app.bundle.js. Faro records page loads, web vitals,
// errors and a browser span for the /api/picks fetch; TracingInstrumentation sends a traceparent
// so the backend trace continues from the click. Faro stays off when no collector URL is set.
import { initializeFaro, getWebInstrumentations } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const config = window.SITE_CONFIG || {};
if (config.faroUrl) {
  initializeFaro({ url: config.faroUrl, app: { name: config.appName, version: config.appVersion, environment: config.environment }, instrumentations: [...getWebInstrumentations(), new TracingInstrumentation()] });
}

const reader = (() => {
  try { const existing = localStorage.getItem('readerId'); if (existing) return existing; const id = `web-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem('readerId', id); return id; }
  catch { return 'web-reader'; }
})();

document.querySelector('#picks-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.querySelector('#result');
  result.textContent = 'Loading…';
  try {
    const response = await fetch('/api/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: document.querySelector('#question').value, userId: reader }) });
    const body = await response.json();
    result.textContent = response.ok ? `${body.answer}\n\n${JSON.stringify(body, null, 2)}` : JSON.stringify(body, null, 2);
  } catch (e) { result.textContent = `Request failed: ${e.message}`; }
});
