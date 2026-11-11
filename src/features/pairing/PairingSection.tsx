import { useId, useState } from 'react';
import { t } from '../../i18n';
import settingsStyles from '../settings/settings.module.css';
import { ReceiveDialog } from './ReceiveDialog';
import { SendDialog } from './SendDialog';

/** Settings section "Second device" (T44): show a pairing QR, or scan one from another device. */
export function PairingSection({
  onPaired,
  iterations,
}: {
  /** Called after received settings were saved, so the page can reload its forms. */
  onPaired?: () => void;
  /** test hook: fewer PBKDF2 iterations for the one-time code */
  iterations?: number;
}) {
  const uid = useId();
  const [open, setOpen] = useState<'send' | 'receive' | null>(null);
  return (
    <section className={settingsStyles.section} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>{t('pairing.title')}</h2>
      <p className={settingsStyles.hint}>{t('pairing.hint')}</p>
      <div className={settingsStyles.row}>
        <button type="button" className={settingsStyles.secondary} onClick={() => setOpen('send')}>
          {t('pairing.send')}
        </button>
        <button
          type="button"
          className={settingsStyles.secondary}
          onClick={() => setOpen('receive')}
        >
          {t('pairing.receive')}
        </button>
      </div>
      {open === 'send' && (
        <SendDialog onClose={() => setOpen(null)} {...(iterations ? { iterations } : {})} />
      )}
      {open === 'receive' && (
        <ReceiveDialog onClose={() => setOpen(null)} {...(onPaired ? { onPaired } : {})} />
      )}
    </section>
  );
}
