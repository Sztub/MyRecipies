import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import styles from './pairing.module.css';

export type CameraProblem = 'unavailable' | 'denied';

const SCAN_EVERY_MS = 250;
const MAX_SCAN_WIDTH = 640; // downscale big camera frames: jsQR is fast enough on a phone at this size

/**
 * Live camera preview that decodes QR codes with jsQR (iOS Safari has no BarcodeDetector).
 * Calls `onResult` with the first decoded text `accept` approves, then stops the camera.
 * The decoded text is only passed on, never logged.
 */
export function CameraScanner({
  accept,
  onResult,
  onProblem,
}: {
  accept: (text: string) => boolean;
  onResult: (text: string) => void;
  onProblem: (p: CameraProblem) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef({ accept, onResult, onProblem });
  useEffect(() => {
    cb.current = { accept, onResult, onProblem };
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      stream = null;
    };

    void (async () => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        cb.current.onProblem('unavailable');
        return;
      }
      try {
        const [s, { default: jsQR }] = await Promise.all([
          media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
          import('jsqr'),
        ]);
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => undefined); // autoplay is allowed for muted inline video
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          stop();
          cb.current.onProblem('unavailable');
          return;
        }
        timer = setInterval(() => {
          if (stopped || video.readyState < 2 || !video.videoWidth) return;
          const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
          const w = Math.round(video.videoWidth * scale);
          const h = Math.round(video.videoHeight * scale);
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const found = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
          if (found && cb.current.accept(found.data)) {
            stop();
            cb.current.onResult(found.data);
          }
        }, SCAN_EVERY_MS);
      } catch (e) {
        stop();
        const name = e instanceof DOMException || e instanceof Error ? e.name : '';
        cb.current.onProblem(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        );
      }
    })();
    return stop;
  }, []);

  return (
    <>
      <p role="status">{t('pairing.receive.scanning')}</p>
      <video
        ref={videoRef}
        className={styles.video}
        muted
        playsInline
        aria-label={t('pairing.receive.video')}
      />
    </>
  );
}
