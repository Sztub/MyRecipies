import { useId, useRef, useState, type FormEvent } from 'react';
import { t, type StringKey } from '../../i18n';
import type { BackupErrorKind } from '../../lib/backup/github-backup';
import { UnlockForm } from '../backup/BackupControls';
import settingsStyles from '../settings/settings.module.css';
import { useKeyState } from '../settings/keyState';
import { applyPairingData } from './apply';
import { CameraScanner, type CameraProblem } from './CameraScanner';
import { Modal } from './Modal';
import {
  PairingError,
  decodePairing,
  isWellFormedCode,
  looksLikePairing,
  type PairingErrorKind,
} from './payload';
import styles from './pairing.module.css';

const UNLOCK_ERROR_KEYS = new Proxy({} as Record<BackupErrorKind, StringKey>, {
  get: (_, kind) => `backup.error.${String(kind)}` as StringKey,
});

type ErrorKey = PairingErrorKind | 'codeFormat' | 'saveFailed';

/**
 * Receiving side: QR via camera (or pasted text) + one-time code → settings and token saved here →
 * passphrase prompt (typed from the paper; it never travels in the payload).
 */
export function ReceiveDialog({
  onClose,
  onPaired,
}: {
  onClose: () => void;
  onPaired?: () => void;
}) {
  const uid = useId();
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState<'off' | 'on' | CameraProblem>('off');
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [done, setDone] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const { state: keyState } = useKeyState();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!looksLikePairing(text)) {
      setError('garbled');
      return;
    }
    if (!isWellFormedCode(code)) {
      setError('codeFormat');
      return;
    }
    setBusy(true);
    try {
      const data = await decodePairing(text, code);
      try {
        await applyPairingData(data);
      } catch {
        setError('saveFailed');
        return;
      }
      setText('');
      setCode('');
      setDone(true);
      onPaired?.();
    } catch (err) {
      setError(err instanceof PairingError ? err.kind : 'garbled');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title={t('pairing.receive.title')} onClose={onClose}>
        <p className={settingsStyles.ok} role="status">
          {t('pairing.receive.done')}
        </p>
        {keyState === 'unlocked' ? (
          <p className={settingsStyles.ok} role="status">
            {t('pairing.receive.unlocked')}
          </p>
        ) : (
          <>
            <p>{t('pairing.receive.passphrase')}</p>
            <UnlockForm errorKeys={UNLOCK_ERROR_KEYS} />
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={t('pairing.receive.title')} onClose={onClose}>
      <p className={settingsStyles.hint}>{t('pairing.receive.intro')}</p>
      {camera === 'on' ? (
        <>
          <CameraScanner
            accept={looksLikePairing}
            onResult={(value) => {
              setText(value);
              setScanned(true);
              setCamera('off');
              setError(null);
              codeRef.current?.focus();
            }}
            onProblem={setCamera}
          />
          <button
            type="button"
            className={settingsStyles.secondary}
            onClick={() => setCamera('off')}
          >
            {t('pairing.receive.stopCamera')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={settingsStyles.primary}
          onClick={() => {
            setScanned(false);
            setCamera('on');
          }}
        >
          {t('pairing.receive.camera')}
        </button>
      )}
      {(camera === 'unavailable' || camera === 'denied') && (
        <p className={settingsStyles.error} role="alert">
          {t(
            camera === 'denied'
              ? 'pairing.receive.cameraDenied'
              : 'pairing.receive.cameraUnavailable',
          )}
        </p>
      )}
      {scanned && (
        <p className={settingsStyles.ok} role="status">
          {t('pairing.receive.scanned')}
        </p>
      )}
      <form className={settingsStyles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className={settingsStyles.field}>
          <label htmlFor={`${uid}-text`}>{t('pairing.receive.pasteLabel')}</label>
          <textarea
            id={`${uid}-text`}
            className={styles.textarea}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setScanned(false);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <div className={settingsStyles.field}>
          <label htmlFor={`${uid}-code`}>{t('pairing.receive.codeLabel')}</label>
          <input
            id={`${uid}-code`}
            ref={codeRef}
            className={`${settingsStyles.input} ${styles.codeInput}`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={16}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <button type="submit" className={settingsStyles.primary} disabled={busy}>
          {busy ? t('pairing.receive.working') : t('pairing.receive.submit')}
        </button>
        {error && (
          <p className={settingsStyles.error} role="alert">
            {t(`pairing.error.${error}` as StringKey)}
          </p>
        )}
      </form>
    </Modal>
  );
}
