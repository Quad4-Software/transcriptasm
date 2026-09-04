/**
 * Register the service worker and auto-apply updates when online.
 */

const UPDATE_TOAST_ID = 'pwa-update-toast';

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
