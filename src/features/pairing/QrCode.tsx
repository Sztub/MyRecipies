import { useEffect, useState } from 'react';
import styles from './pairing.module.css';

const QUIET = 4; // quiet zone in modules, required by the QR spec

/** Renders `text` as an SVG QR code (error correction M). The generator is loaded on demand. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let live = true;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const q = qrcode(0, 'M');
      q.addData(text, 'Byte');
      q.make();
      const n = q.getModuleCount();
      let path = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++)
          if (q.isDark(r, c)) path += `M${c + QUIET},${r + QUIET}h1v1h-1z`;
      }
      if (live) setQr({ size: n + 2 * QUIET, path });
    });
    return () => {
      live = false;
    };
  }, [text]);

  return (
    <div className={styles.qr} role="img" aria-label={label} data-testid="pairing-qr">
      {qr && (
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" aria-hidden="true">
          <path className={styles.qrDark} d={qr.path} />
        </svg>
      )}
    </div>
  );
}
