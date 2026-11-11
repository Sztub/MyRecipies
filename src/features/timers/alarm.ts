import { t } from '../../i18n';
import type { Timer } from './timerStore';

let audio: AudioContext | undefined;

/** Call from a user gesture (starting a timer) so the browser later allows the alarm sound. */
export function primeAlarm(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; // Safari < 14.1
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // no audio available
  }
}

/** Ask for notification permission once; only called from a tap on a timer chip. */
export function requestNotifications(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    // unsupported
  }
}

function beeps(): void {
  const ctx = audio;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 6; i += 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + i * 0.5);
    osc.stop(t0 + i * 0.5 + 0.25);
  }
}

/** Sound + vibration + notification, each only where the platform supports it. */
export function ringAlarm(timer: Timer): void {
  try {
    beeps();
  } catch {
    // ignore
  }
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    // ignore
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(t('timers.done'), { body: timer.label });
    }
  } catch {
    // Some Android browsers only allow notifications through a service worker.
  }
}
