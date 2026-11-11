import { useId, useState, type ChangeEvent } from 'react';
import { t, type StringKey } from '../../i18n';
import {
  BundleError,
  blobToText,
  buildBundle,
  bundleFileName,
  bundleToJson,
  importBundle,
  parseBundle,
  saveTextFile,
  summarizeBundle,
  type Bundle,
  type BundleErrorCode,
  type ImportMode,
  type ImportReport,
} from '../../lib/backup';
import styles from './LocalBackup.module.css';

const ERROR_KEYS: Record<BundleErrorCode, StringKey> = {
  'invalid-json': 'localBackup.error.invalid-json',
  'wrong-format': 'localBackup.error.wrong-format',
  'unsupported-version': 'localBackup.error.unsupported-version',
  'invalid-shape': 'localBackup.error.invalid-shape',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Local file export/import of the backup bundle (T05). Embedded in Settings by T08. */
export function LocalBackup() {
  const ids = useId();
  const [exportStatus, setExportStatus] = useState<Status>({ kind: 'idle' });
  const [importStatus, setImportStatus] = useState<Status>({ kind: 'idle' });
  const [pending, setPending] = useState<Bundle | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge-add-missing');
  const [report, setReport] = useState<ImportReport | null>(null);

  async function onExport() {
    setExportStatus({ kind: 'busy' });
    try {
      const bundle = await buildBundle({ includePhotoData: true });
      const res = await saveTextFile(
        bundleToJson(bundle),
        bundleFileName(new Date(bundle.createdAt)),
      );
      setExportStatus(
        res === 'cancelled' ? { kind: 'idle' } : { kind: 'ok', text: t('localBackup.export.done') },
      );
    } catch {
      setExportStatus({ kind: 'error', text: t('localBackup.export.failed') });
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setPending(null);
    setReport(null);
    if (!file) return;
    setImportStatus({ kind: 'busy' });
    try {
      const bundle = parseBundle(await blobToText(file));
      setPending(bundle);
      setMode('merge-add-missing');
      setImportStatus({ kind: 'idle' });
    } catch (err) {
      const key = err instanceof BundleError ? ERROR_KEYS[err.code] : 'localBackup.error.read';
      setImportStatus({ kind: 'error', text: t(key) });
    }
  }

  async function onImport() {
    if (!pending) return;
    setImportStatus({ kind: 'busy' });
    try {
      const r = await importBundle(pending, mode);
      setReport(r);
      setPending(null);
      setImportStatus({ kind: 'ok', text: t('localBackup.import.done') });
    } catch {
      setImportStatus({ kind: 'error', text: t('localBackup.import.failed') });
    }
  }

  async function onSaveSafety() {
    if (!report?.safetyExport) return;
    await saveTextFile(report.safetyExport.json, report.safetyExport.fileName);
  }

  const summary = pending ? summarizeBundle(pending) : null;
  const busy = exportStatus.kind === 'busy' || importStatus.kind === 'busy';

  return (
    <section className={styles.root} aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className={styles.title}>
        {t('localBackup.title')}
      </h2>

      <div className={styles.block}>
        <p className={styles.hint}>{t('localBackup.export.hint')}</p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void onExport()}
          disabled={busy}
        >
          {t('localBackup.export.button')}
        </button>
        <StatusLine status={exportStatus} />
      </div>

      <div className={styles.block}>
        <p className={styles.hint}>{t('localBackup.import.hint')}</p>
        <input
          id={`${ids}-file`}
          type="file"
          accept=".json,application/json"
          className={styles.fileInput}
          onChange={(e) => void onFile(e)}
          disabled={busy}
        />
        <label htmlFor={`${ids}-file`} className={styles.secondary}>
          {t('localBackup.import.choose')}
        </label>

        {summary && (
          <div className={styles.preview} aria-label={t('localBackup.preview.title')}>
            <h3 className={styles.subtitle}>{t('localBackup.preview.title')}</h3>
            <dl className={styles.facts}>
              <dt>{t('localBackup.preview.date')}</dt>
              <dd>{formatDate(summary.createdAt)}</dd>
              <dt>{t('localBackup.preview.device')}</dt>
              <dd className={styles.mono}>{summary.deviceId}</dd>
              <dt>{t('localBackup.preview.recipes')}</dt>
              <dd>{summary.recipes}</dd>
              <dt>{t('localBackup.preview.categories')}</dt>
              <dd>{summary.categories}</dd>
              <dt>{t('localBackup.preview.tags')}</dt>
              <dd>{summary.tags}</dd>
              <dt>{t('localBackup.preview.photos')}</dt>
              <dd>{summary.photos}</dd>
            </dl>

            <fieldset className={styles.modes}>
              <legend>{t('localBackup.mode.legend')}</legend>
              <label className={styles.mode}>
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  checked={mode === 'merge-add-missing'}
                  onChange={() => setMode('merge-add-missing')}
                />
                <span>
                  <strong>{t('localBackup.mode.merge')}</strong>
                  <br />
                  {t('localBackup.mode.merge.hint')}
                </span>
              </label>
              <label className={styles.mode}>
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                <span>
                  <strong>{t('localBackup.mode.replace')}</strong>
                  <br />
                  {t('localBackup.mode.replace.hint')}
                </span>
              </label>
            </fieldset>
            {mode === 'replace' && (
              <p className={styles.warning} role="note">
                {t('localBackup.mode.replace.warning')}
              </p>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void onImport()}
                disabled={busy}
              >
                {mode === 'replace'
                  ? t('localBackup.import.replaceButton')
                  : t('localBackup.import.mergeButton')}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setPending(null)}
                disabled={busy}
              >
                {t('localBackup.import.cancel')}
              </button>
            </div>
          </div>
        )}

        <StatusLine status={importStatus} />

        {report && (
          <div className={styles.report} aria-label={t('localBackup.report.title')}>
            <h3 className={styles.subtitle}>{t('localBackup.report.title')}</h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th />
                  <th scope="col">{t('localBackup.report.added')}</th>
                  <th scope="col">{t('localBackup.report.skipped')}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['localBackup.preview.recipes', report.recipes],
                    ['localBackup.preview.categories', report.categories],
                    ['localBackup.preview.tags', report.tags],
                    ['localBackup.preview.photos', report.photos],
                  ] as const
                ).map(([key, c]) => (
                  <tr key={key}>
                    <th scope="row">{t(key)}</th>
                    <td>{c.added}</td>
                    <td>{c.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.photos.missing.length + report.photos.invalid.length > 0 && (
              <p className={styles.warning}>
                {t('localBackup.report.photoProblems')}{' '}
                {report.photos.missing.length + report.photos.invalid.length}
              </p>
            )}
            {report.safetyExport && (
              <div className={styles.actions}>
                <p className={styles.hint}>{t('localBackup.report.safetyHint')}</p>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void onSaveSafety()}
                >
                  {t('localBackup.report.safetyButton')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'busy') {
    return (
      <p className={styles.status} role="status">
        {t('localBackup.working')}
      </p>
    );
  }
  if (status.kind === 'ok') {
    return (
      <p className={styles.status} role="status">
        {status.text}
      </p>
    );
  }
  if (status.kind === 'error') {
    return (
      <p className={styles.error} role="alert">
        {status.text}
      </p>
    );
  }
  return null;
}
