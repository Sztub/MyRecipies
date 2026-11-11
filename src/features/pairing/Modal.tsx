import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import settingsStyles from '../settings/settings.module.css';
import styles from './pairing.module.css';

/** Minimal modal: Escape / Close button close it, focus moves in on open and back on close. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  // Portal: the page content sits in a lower stacking context than the app header.
  return createPortal(
    <div className={styles.overlay}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        tabIndex={-1}
      >
        <h2 id={`${uid}-title`}>{title}</h2>
        {children}
        <button type="button" className={settingsStyles.secondary} onClick={onClose}>
          {t('pairing.close')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
