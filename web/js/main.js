import { bootApp } from './ui/app.js';
import { registerPWA } from './pwa.js';

registerPWA().catch(() => {});

bootApp().catch((err) => {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = err && err.message ? err.message : String(err);
  }
  console.error(err);
});
