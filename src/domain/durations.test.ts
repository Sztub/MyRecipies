import { findDurations, formatClock, segmentDurations } from './durations';

const secs = (s: string) => findDurations(s).map((d) => d.seconds);

describe('findDurations', () => {
  it.each([
    ['Piecz 40 min', [2400]],
    ['bake 40 min', [2400]],
    ['bake for 40 minutes.', [2400]],
    ['Gotuj 20 minut', [1200]],
    ['Gotuj 1 minutę', [60]],
    ['gotuj 2 minuty', [120]],
    ['Odstaw na 1,5 godziny', [5400]],
    ['rest 1.5 hours', [5400]],
    ['Piecz 2 godziny', [7200]],
    ['Piecz 1 godzinę', [3600]],
    ['Piecz godzinę', [3600]],
    ['bake 1 hour', [3600]],
    ['Wyrastać półtorej godziny', [5400]],
    ['Wyrastać pół godziny', [1800]],
    ['let rise half an hour', [1800]],
    ['simmer for an hour', [3600]],
    ['1 h 30 min', [5400]],
    ['1h 30min', [5400]],
    ['1h30', [5400]],
    ['1 godzinę i 30 minut', [5400]],
    ['2 hours and 15 minutes', [8100]],
    ['10–15 min', [900]],
    ['10-15 minut', [900]],
    ['10 do 15 minut', [900]],
    ['10 to 15 minutes', [900]],
    ['smaż 30 sekund', [30]],
    ['stir 45 sec', [45]],
    ['PIECZ 40 MIN', [2400]],
    ['Piecz 40 min., potem studź 10 min', [2400, 600]],
  ])('%s', (text, expected) => {
    expect(secs(text)).toEqual(expected);
  });

  it.each([
    'Piekarnik 180 °C',
    'Dodaj 200 g mąki',
    'Dodaj 2 sztuki',
    'Weź 3 łyżki cukru',
    'Add 1 cup of flour',
    'minimum 5 osób',
    'Krok 3',
    '',
    'Add 10 h2o',
  ])('no duration in %j', (text) => {
    expect(findDurations(text)).toEqual([]);
  });

  it('keeps offsets of the matched text', () => {
    const text = 'Piecz 1 h 30 min w 180 °C';
    const [m] = findDurations(text);
    expect(m?.text).toBe('1 h 30 min');
    expect(text.slice(m?.start, m?.end)).toBe('1 h 30 min');
  });

  it('does not join two independent durations', () => {
    expect(secs('Piecz 40 min, potem 10 min')).toEqual([2400, 600]);
    expect(secs('10 min, 1 h')).toEqual([600, 3600]);
  });
});

describe('segmentDurations', () => {
  it('splits and preserves text', () => {
    const segs = segmentDurations('Piecz 40 min i studź.');
    expect(segs).toEqual(['Piecz ', { text: '40 min', seconds: 2400 }, ' i studź.']);
  });
  it('returns a single string when nothing matches', () => {
    expect(segmentDurations('Pokrój')).toEqual(['Pokrój']);
  });
});

describe('formatClock', () => {
  it('formats', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.2)).toBe('1:00');
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
