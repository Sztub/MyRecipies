export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.8;

/** Scales (w, h) down so the longer side is at most `max`; never upscales. Sizes are whole pixels ≥ 1. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_DIMENSION,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
