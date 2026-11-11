import { registerSW } from 'virtual:pwa-register';
import { setUpdateAvailable } from './updateStore';

const HOUR = 60 * 60 * 1000;

/**
 * Registers the service worker, surfaces "new version" through the update store, and
 * re-checks for updates on start, whenever the app becomes visible again (iOS keeps
 * installed PWAs alive for days) and hourly while open.
 */
export function registerPwa(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      setUpdateAvailable(() => updateSW(true));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      };
      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, HOUR);
    },
  });
}
