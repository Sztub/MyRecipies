import { useEffect, useState } from 'react';
import { photos } from '../../db';
import { t } from '../../i18n';
import styles from './photos.module.css';

export interface PhotoViewProps {
  hash: string;
  alt?: string;
  className?: string;
}

/** Shows a stored photo; creates the object URL on load and revokes it on change/unmount. */
export function PhotoView({ hash, alt = '', className }: PhotoViewProps) {
  // Result is keyed by hash so a stale result is never shown for a new hash.
  const [loaded, setLoaded] = useState<{ hash: string; url: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    photos
      .get(hash)
      .then((p) => {
        if (cancelled) return;
        if (p) created = URL.createObjectURL(p.blob);
        setLoaded({ hash, url: created });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ hash, url: null });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [hash]);

  const current = loaded?.hash === hash ? loaded : null;
  const url = current?.url ?? null;
  const missing = current !== null && current.url === null;

  const cls = `${styles.placeholder} ${className ?? ''}`;
  if (missing) {
    return (
      <span className={cls} role="img" aria-label={alt || t('photos.missing')}>
        {t('photos.missing')}
      </span>
    );
  }
  if (!url) return <span className={cls} aria-hidden="true" />;
  return <img src={url} alt={alt} className={className} />;
}
