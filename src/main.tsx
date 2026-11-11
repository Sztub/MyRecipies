import './csp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './app/global.css';
import { App } from './app/App';
import { initTheme } from './theme';
import { initDb } from './db';
import { requestPersist } from './pwa';
import { registerPwa } from './pwa/registerPwa';

initTheme();

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Device ID + default categories must exist before screens read the DB.
// Render even if IndexedDB init fails so the app shell still shows.
initDb()
  .catch((err: unknown) => console.error('DB init failed', err))
  .finally(render);

void requestPersist();
if (import.meta.env.PROD) registerPwa();
