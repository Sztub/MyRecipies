import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { routes } from './routes';
import { OrnamentDefs } from '../theme';

export function App() {
  // BASE_URL honours the configurable Vite base (e.g. /MyRecipies/ on GitHub Pages).
  const router = useMemo(
    () => createBrowserRouter(routes, { basename: import.meta.env.BASE_URL }),
    [],
  );
  // Keyed on the language so every screen re-renders its t() strings after a switch in Settings.
  const lang = useLanguage();
  return (
    <>
      <OrnamentDefs />
      <RouterProvider key={lang} router={router} />
    </>
  );
}
