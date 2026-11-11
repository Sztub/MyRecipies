import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './recipes.module.css';

/**
 * Centred modal confirmation (#70): always on screen, whatever the scroll position.
 * Focus starts on Cancel (the safe choice); Escape or a tap on the backdrop cancels.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  // Portal: page content sits in a lower stacking context than the sticky app header.
  return createPortal(
    <div
      className={styles.overlay}
      data-testid="confirm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.confirm}
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
        aria-describedby={`${uid}-msg`}
      >
        <p id={`${uid}-msg`} className={styles.confirmText}>
          {message}
        </p>
        <div className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className={styles.btn} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
