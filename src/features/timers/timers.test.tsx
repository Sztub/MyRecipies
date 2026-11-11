import { act, fireEvent, render, screen } from '@testing-library/react';
import { StepText } from './StepText';
import { TimerBar } from './TimerBar';
import { TIMERS_STORAGE_KEY, getTimers, resetTimersForTests, setAlarmHandler } from './timerStore';
import * as alarm from './alarm';

function Harness() {
  return (
    <>
      <p>
        <StepText text="Bake 40 min, then rest 10 s." label="Cake" />
      </p>
      <TimerBar />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  resetTimersForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('step timers', () => {
  it('renders durations as chips and counts down', () => {
    render(<Harness />);
    expect(screen.queryByRole('region', { name: 'Timers' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start timer: 40 min' }));
    expect(screen.getByRole('region', { name: 'Timers' })).toBeInTheDocument();
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('40:00');
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('38:55');
  });

  it('runs several timers at once and cancels one', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start timer: 40 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start timer: 10 s' }));
    expect(screen.getAllByTestId('timer-clock')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel timer: Cake' })[0] as HTMLElement);
    expect(screen.getAllByTestId('timer-clock')).toHaveLength(1);
  });

  it('rings once when the time is up and stays until dismissed', () => {
    const ring = vi.fn();
    vi.spyOn(alarm, 'primeAlarm').mockImplementation(() => undefined);
    vi.spyOn(alarm, 'requestNotifications').mockImplementation(() => undefined);
    render(<Harness />);
    setAlarmHandler(ring);
    fireEvent.click(screen.getByRole('button', { name: 'Start timer: 10 s' }));
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(ring).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Time is up!');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(ring).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss timer: Cake' }));
    expect(screen.queryByRole('region', { name: 'Timers' })).not.toBeInTheDocument();
  });

  it('stores the end time so timers survive a reload', () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start timer: 40 min' }));
    const stored: unknown = JSON.parse(localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]');
    expect(stored).toEqual([
      expect.objectContaining({ label: 'Cake', seconds: 2400, endAt: Date.now() + 2_400_000 }),
    ]);
    unmount();
    expect(getTimers()).toHaveLength(1);
  });
});
