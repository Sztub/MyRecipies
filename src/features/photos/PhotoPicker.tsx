import { useState, type ChangeEvent } from 'react';
import { photos } from '../../db';
import { t } from '../../i18n';
import { processImage } from '../../lib/image';
import type { Photo } from '../../domain/types';
import { PhotoView } from './PhotoView';
import styles from './photos.module.css';

export interface PhotoPickerProps {
  value: string[];
  onChange: (hashes: string[]) => void;
  max?: number;
  /** Injectable for tests; defaults to the browser pipeline. */
  processor?: (file: File) => Promise<Photo>;
}

export function PhotoPicker({ value, onChange, max, processor = processImage }: PhotoPickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = max !== undefined && value.length >= max;
  const disabled = full || busy;

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow picking the same file again
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const start = value;
    let next = start;
    let failed = false;
    for (const file of files) {
      if (max !== undefined && next.length >= max) break;
      try {
        const photo = await processor(file);
        await photos.put(photo);
        if (!next.includes(photo.hash)) next = [...next, photo.hash];
      } catch {
        failed = true;
      }
    }
    if (next !== start) onChange(next);
    if (failed) setError(t('photos.error.decode'));
    setBusy(false);
  }

  return (
    <div className={styles.picker}>
      {value.length > 0 && (
        <ul className={styles.list}>
          {value.map((hash) => (
            <li key={hash} className={styles.item}>
              <PhotoView hash={hash} className={styles.thumb} />
              <button
                type="button"
                className={styles.remove}
                aria-label={t('photos.remove')}
                onClick={() => onChange(value.filter((h) => h !== hash))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <label className={`${styles.button} ${disabled ? styles.disabled : ''}`}>
          {t('photos.take')}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.input}
            disabled={disabled}
            onChange={handle}
            data-testid="photo-camera"
          />
        </label>
        <label className={`${styles.button} ${disabled ? styles.disabled : ''}`}>
          {t('photos.choose')}
          <input
            type="file"
            accept="image/*"
            multiple={max === undefined || max - value.length > 1}
            className={styles.input}
            disabled={disabled}
            onChange={handle}
            data-testid="photo-gallery"
          />
        </label>
      </div>
      {busy && <p role="status">{t('photos.processing')}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
