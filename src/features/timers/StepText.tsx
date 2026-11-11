import { segmentDurations } from '../../domain/durations';
import { t } from '../../i18n';
import { primeAlarm, requestNotifications } from './alarm';
import { startTimer } from './timerStore';
import styles from './timers.module.css';

/** Step text where every detected duration is a tappable chip that starts a timer. */
export function StepText({ text, label }: { text: string; label: string }) {
  return (
    <>
      {segmentDurations(text).map((seg, i) =>
        typeof seg === 'string' ? (
          seg
        ) : (
          <button
            key={i}
            type="button"
            className={styles.chip}
            aria-label={t('timers.start', { duration: seg.text })}
            onClick={() => {
              primeAlarm();
              requestNotifications();
              startTimer(label, seg.seconds);
            }}
          >
            <span aria-hidden="true">⏱ </span>
            {seg.text}
          </button>
        ),
      )}
    </>
  );
}
