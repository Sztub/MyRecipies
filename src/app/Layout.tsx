import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';
import { t } from '../i18n';
import { UpdateBanner } from '../pwa';
import { SyncBadge } from '../features/sync';
import { TimerBar } from '../features/timers';
import styles from './Layout.module.css';

const links = [
  { to: '/', label: 'nav.recipes', end: true },
  { to: '/recipes/new', label: 'nav.newRecipe', end: true },
  { to: '/manage', label: 'nav.manage', end: false },
  { to: '/sync', label: 'nav.sync', end: false },
  { to: '/settings', label: 'nav.settings', end: false },
] as const;

/** Where the header back button leads on sub-pages (top-level menu pages have none). */
export function backTarget(pathname: string): string | null {
  if (matchPath('/recipes/new', pathname)) return '/';
  const edit = matchPath('/recipes/:id/edit', pathname);
  if (edit?.params.id) return `/recipes/${edit.params.id}`;
  if (matchPath('/recipes/:id', pathname)) return '/';
  if (matchPath('/settings/*', pathname) && pathname !== '/settings' && pathname !== '/settings/') return '/settings';
  return null;
}

export function Layout() {
  const location = useLocation();
  const back = backTarget(location.pathname);
  // The drawer is open only for the location it was opened on, so any navigation closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === location.key;
  const setOpen = useCallback(
    (v: boolean | ((o: boolean) => boolean)) => {
      setOpenAt((cur) =>
        (typeof v === 'function' ? v(cur === location.key) : v) ? location.key : null,
      );
    },
    [location.key],
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) toggleRef.current?.focus();
    },
    [setOpen],
  );

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, [open]);

  // Escape closes the drawer wherever focus is: Safari does not focus a tapped button, so focus may be on <body>.
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, close]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open || e.key !== 'Tab') return;
    // Keep Tab inside the drawer while it is open as a modal (narrow screens only).
    if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches)
      return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a') ?? []);
    const toggle = toggleRef.current;
    const ring = toggle ? [toggle, ...items] : items;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.shell} onKeyDown={onKeyDown}>
      <header className={styles.header} data-ui="app-header">
        {back && (
          <Link to={back} className={styles.backButton}>
            <span aria-hidden="true">‹</span> {t('nav.back')}
          </Link>
        )}
        <button
          ref={toggleRef}
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="side-menu"
          aria-label={open ? t('nav.close') : t('nav.open')}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">{open ? '✕' : '☰'}</span>
        </button>
        <h1 className={styles.title} data-ui="app-title">
          {t('app.title')}
        </h1>
      </header>
      <div className={styles.body}>
        {open && (
          <div
            className={styles.backdrop}
            data-testid="menu-backdrop"
            onClick={() => close(false)}
          />
        )}
        <nav
          id="side-menu"
          ref={menuRef}
          className={open ? `${styles.menu} ${styles.menuOpen}` : styles.menu}
          aria-label={t('nav.main')}
        >
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={styles.link}>
              {t(l.label)}
              {l.to === '/sync' && <SyncBadge />}
            </NavLink>
          ))}
        </nav>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
      <TimerBar />
      <UpdateBanner />
    </div>
  );
}
