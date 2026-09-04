/**
 * Register the service worker, enable COOP/COEP isolation, and auto-apply updates.
 */

const UPDATE_TOAST_ID = 'pwa-update-toast';
const COI_RELOAD_KEY = 'transcriptasm-coi-reload';

/**
 * @returns {Promise<void>}
 */
export async function registerPWA() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    wireAutoUpdate(reg);
    await ensureCrossOriginIsolated();
  } catch (err) {
    console.warn('PWA registration failed', err);
  }
}

/**
 * @param {ServiceWorkerRegistration} reg
 */
function wireAutoUpdate(reg) {
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      return;
    }
    // First SW claim: ensureCrossOriginIsolated reloads for COOP/COEP.
    if (!globalThis.crossOriginIsolated) {
      return;
    }
    refreshing = true;
    showUpdateToast('Updating...');
    window.location.reload();
  });

  const askWaiting = () => {
    if (reg.waiting) {
      showUpdateToast('Updating...');
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  askWaiting();

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) {
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        if (navigator.serviceWorker.controller) {
          showUpdateToast('Updating...');
          (reg.waiting || worker).postMessage({ type: 'SKIP_WAITING' });
        }
      }
    });
  });

  const check = () => {
    if (!navigator.onLine) {
      return;
    }
    reg.update().catch(() => {});
  };

  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      check();
    }
  });
  window.addEventListener('focus', check);
  setInterval(check, 60 * 1000);
  check();
}

/**
 * Pages hosts lack COOP/COEP. After the SW injects them, reload once so the
 * document becomes crossOriginIsolated and SharedArrayBuffer works.
 * @returns {Promise<void>}
 */
async function ensureCrossOriginIsolated() {
  if (globalThis.crossOriginIsolated) {
    sessionStorage.removeItem(COI_RELOAD_KEY);
    return;
  }

  if (!navigator.serviceWorker.controller) {
    await Promise.race([
      new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      }),
      new Promise((resolve) => {
        setTimeout(resolve, 4000);
      }),
    ]);
  }

  if (globalThis.crossOriginIsolated) {
    sessionStorage.removeItem(COI_RELOAD_KEY);
    return;
  }

  const attempts = Number(sessionStorage.getItem(COI_RELOAD_KEY) || '0');
  if (attempts >= 2) {
    console.warn('cross-origin isolation unavailable after reload');
    return;
  }

  sessionStorage.setItem(COI_RELOAD_KEY, String(attempts + 1));
  showUpdateToast('Updating...');
  window.location.reload();
  await new Promise(() => {});
}

/**
 * @param {string} text
 */
function showUpdateToast(text) {
  let el = document.getElementById(UPDATE_TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = UPDATE_TOAST_ID;
    el.className = 'pwa-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
}
