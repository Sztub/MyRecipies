import { useEffect, useState } from 'react';
import { formatClock } from '../../domain/durations';
import { t } from '../../i18n';
import { ringAlarm } from './alarm';
import { checkTimers, removeTimer, setAlarmHandler, useTimers } from './timerStore';
import styles from './timers.module.css';

/** Floating bar listing running and finished timers; mounted once in Layout. */
export function TimerBar({ cooking = false }: { cooking?: boolean }) {
  const timers = useTimers();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setAlarmHandler(ringAlarm);
  }, []);

  const active = timers.length > 0;
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => {
      setNow(Date.now());
      checkTimers();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    // Timers are throttled in background tabs: re-check as soon as the page is visible again.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active]);

  if (!active) return null;
  return (
    <section
      className={cooking ? `${styles.bar} ${styles.barCooking}` : styles.bar}
      aria-label={t('timers.title')}
    >
      <ul className={styles.list}>
        {timers.map((timer) => {
          const left = Math.max(0, (timer.endAt - now) / 1000);
          const done = timer.rang || left <= 0;
          return (
            <li key={timer.id} className={done ? `${styles.item} ${styles.done}` : styles.item}>
              <span className={styles.label}>{timer.label}</span>
              {done ? (
                <strong role="alert" className={styles.clock}>
                  {t('timers.done')}
                </strong>
              ) : (
                <span className={styles.clock} data-testid="timer-clock">
                  {formatClock(left)}
                </span>
              )}
              <button
                type="button"
                className={styles.btn}
                aria-label={t(done ? 'timers.dismiss' : 'timers.cancel', { label: timer.label })}
                onClick={() => removeTimer(timer.id)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
