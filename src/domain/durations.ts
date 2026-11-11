/** Duration detection in free step text (Polish + English). Pure, no I/O. */

export interface DurationMatch {
  /** Start offset in the text (inclusive). */
  start: number;
  /** End offset in the text (exclusive). */
  end: number;
  /** Matched text, e.g. "1 h 30 min". */
  text: string;
  /** Timer length in seconds (ranges use the upper bound). */
  seconds: number;
}

export type TextSegment = string | { text: string; seconds: number };

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const NOT_WORD = String.raw`(?![\p{L}\d])`;
const SEC = String.raw`sekund\p{L}*|seconds?|secs?|s`;
const MIN = String.raw`minut\p{L}*|minutes?|mins?|min`;
const HOUR = String.raw`godzin\p{L}*|godz|hours?|hrs?|h`;
const UNIT = `(?:${SEC}|${MIN}|${HOUR})`;

const MAX_SECONDS = 99 * 3600;

// Alternatives, tried in this order at each position:
//  hh/hm   "1h30"            hours directly followed by minutes without a unit
//  word    "półtorej godziny", "pół godziny", "half an hour", "an hour", "a minute"
//  single  "godzinę", "minutę", "sekundę"
//  a/b     "40 min", "1,5 godziny", "10–15 min", "10 do 15 minut"
const PATTERN = new RegExp(
  [
    String.raw`(?<![\p{L}\d])(?<hh>\d{1,2})\s*(?:${HOUR})\.?\s*(?<hm>[0-5]?\d)(?![\p{L}\d.,:])(?!\s*${UNIT}${NOT_WORD})`,
    String.raw`(?<![\p{L}\d])(?<word>półtorej|półtora|pół|half an|half a|an|a)\s+(?<wunit>${HOUR}|${MIN})${NOT_WORD}`,
    String.raw`(?<![\p{L}\d])(?<single>godzinę|minutę|sekundę)${NOT_WORD}`,
    String.raw`(?<![\p{L}\d.,])(?<a>${NUM})\s*(?:(?:[-–—]|do|to)\s*(?<b>${NUM})\s*)?(?<unit>${UNIT})${NOT_WORD}`,
  ].join('|'),
  'giu',
);

type Rank = 0 | 1 | 2; // sec < min < hour

function unitInfo(unit: string): { mult: number; rank: Rank } {
  const u = unit.toLowerCase();
  if (/^(sekund|second|sec|s$)/u.test(u)) return { mult: 1, rank: 0 };
  if (/^min/u.test(u)) return { mult: 60, rank: 1 };
  return { mult: 3600, rank: 2 };
}

function toNumber(s: string): number {
  return Number(s.replace(',', '.'));
}

interface Part {
  start: number;
  end: number;
  seconds: number;
  rank: Rank;
  /** Part can be joined with a lower-unit part after it ("1 h" + "30 min"). */
  compound: boolean;
}

function collectParts(text: string): Part[] {
  const parts: Part[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const g = m.groups ?? {};
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let seconds: number;
    let rank: Rank;
    let compound = true;
    if (g.hh !== undefined && g.hm !== undefined) {
      seconds = toNumber(g.hh) * 3600 + toNumber(g.hm) * 60;
      rank = 1;
      compound = false;
    } else if (g.word !== undefined && g.wunit !== undefined) {
      const info = unitInfo(g.wunit);
      const w = g.word.toLowerCase();
      const factor = w === 'półtorej' || w === 'półtora' ? 1.5 : w === 'an' || w === 'a' ? 1 : 0.5;
      seconds = factor * info.mult;
      rank = info.rank;
      compound = false;
    } else if (g.single !== undefined) {
      const info = unitInfo(g.single);
      seconds = info.mult;
      rank = info.rank;
    } else if (g.a !== undefined && g.unit !== undefined) {
      const info = unitInfo(g.unit);
      seconds = toNumber(g.b ?? g.a) * info.mult;
      rank = info.rank;
      compound = g.b === undefined;
    } else continue;
    seconds = Math.round(seconds);
    if (seconds <= 0 || seconds > MAX_SECONDS) continue;
    parts.push({ start, end, seconds, rank, compound });
  }
  return parts;
}

/** Find every duration in `text`, left to right. "1 h 30 min" is one match; "10–15 min" is 15 min. */
export function findDurations(text: string): DurationMatch[] {
  const out: DurationMatch[] = [];
  let prev: Part | undefined;
  let cur: { start: number; end: number; seconds: number } | undefined;
  const flush = () => {
    if (cur) out.push({ ...cur, text: text.slice(cur.start, cur.end) });
    cur = undefined;
  };
  for (const p of collectParts(text)) {
    const gap = prev ? text.slice(prev.end, p.start) : '';
    if (
      cur &&
      prev &&
      prev.compound &&
      p.compound &&
      p.rank < prev.rank &&
      /^\s*(?:i|oraz|and|,)?\s*$/iu.test(gap)
    ) {
      cur.end = p.end;
      cur.seconds += p.seconds;
    } else {
      flush();
      cur = { start: p.start, end: p.end, seconds: p.seconds };
    }
    prev = p;
  }
  flush();
  return out;
}

/** Split text into plain strings and duration pieces, preserving all characters. */
export function segmentDurations(text: string): TextSegment[] {
  const segs: TextSegment[] = [];
  let pos = 0;
  for (const m of findDurations(text)) {
    if (m.start > pos) segs.push(text.slice(pos, m.start));
    segs.push({ text: m.text, seconds: m.seconds });
    pos = m.end;
  }
  if (pos < text.length) segs.push(text.slice(pos));
  return segs;
}

/** "1:05:09" / "5:09" countdown text for a number of seconds (rounded up). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
