// Imported first by main.tsx. The production build ships a Content-Security-Policy without
// 'unsafe-eval' (vite.config.ts → cspPlugin), so zod must not probe `new Function` for its JIT:
// the probe is caught, but still reports a CSP violation on every load.
import { z } from 'zod';

z.config({ jitless: true });
