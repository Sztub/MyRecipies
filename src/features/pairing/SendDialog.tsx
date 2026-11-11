import { useEffect, useId, useState } from 'react';
import { t } from '../../i18n';
import settingsStyles from '../settings/settings.module.css';
import { collectPairingData } from './apply';
import { Modal } from './Modal';
import { encodePairing, formatCode, generatePairingCode } from './payload';
import styles from './pairing.module.css';
import { QrCode } from './QrCode';

type State =
  | { kind: 'preparing' }
  | { kind: 'not-configured' }
  | { kind: 'failed' }
  | { kind: 'ready'; code: string; payload: string };

/**
 * Sending side: a fresh one-time code + encrypted payload every time the dialog opens. Both live only in
 * this component's state, so closing the dialog (unmount) makes the code unusable from this screen.
 */
export function SendDialog({
  onClose,
  iterations,
}: {
  onClose: () => void;
  /** test hook */ iterations?: number;
}) {
  const uid = useId();
  const [state, setState] = useState<State>({ kind: 'preparing' });
  const [copy, setCopy] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await collectPairingData();
        if (!data) {
          if (live) setState({ kind: 'not-configured' });
          return;
        }
        const code = generatePairingCode();
        const payload = await encodePairing(data, code, iterations ? { iterations } : {});
        if (live) setState({ kind: 'ready', code, payload });
      } catch {
        if (live) setState({ kind: 'failed' });
      }
    })();
    return () => {
      live = false;
    };
  }, [iterations]);

  async function onCopy(payload: string) {
    try {
      await navigator.clipboard.writeText(payload);
      setCopy('ok');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <Modal title={t('pairing.send.title')} onClose={onClose}>
      {state.kind === 'preparing' && <p role="status">{t('pairing.send.preparing')}</p>}
      {state.kind === 'not-configured' && (
        <p className={settingsStyles.error} role="alert">
          {t('pairing.send.notConfigured')}
        </p>
      )}
      {state.kind === 'failed' && (
        <p className={settingsStyles.error} role="alert">
          {t('pairing.send.failed')}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <p className={settingsStyles.hint}>{t('pairing.send.instructions')}</p>
          <QrCode text={state.payload} label={t('pairing.send.qrLabel')} />
          <div>
            <p className={settingsStyles.hint} id={`${uid}-code`}>
              {t('pairing.send.codeLabel')}
            </p>
            <p className={styles.code} aria-labelledby={`${uid}-code`} data-testid="pairing-code">
              {formatCode(state.code)}
            </p>
          </div>
          <p className={settingsStyles.hint}>{t('pairing.send.codeHint')}</p>
          <details className={styles.details}>
            <summary>{t('pairing.send.textToggle')}</summary>
            <label htmlFor={`${uid}-text`}>{t('pairing.send.textLabel')}</label>
            <textarea
              id={`${uid}-text`}
              className={styles.textarea}
              readOnly
              value={state.payload}
              spellCheck={false}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={settingsStyles.secondary}
              onClick={() => void onCopy(state.payload)}
            >
              {t('pairing.send.copy')}
            </button>
            <div role="status" aria-live="polite">
              {copy === 'ok' && <p className={settingsStyles.ok}>{t('pairing.send.copied')}</p>}
              {copy === 'failed' && (
                <p className={settingsStyles.error}>{t('pairing.send.copyFailed')}</p>
              )}
            </div>
          </details>
        </>
      )}
    </Modal>
  );
}
