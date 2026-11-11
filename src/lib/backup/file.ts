// Browser-only helpers: save a backup file via Web Share (if it can share files) or a download.

export type SaveResult = 'shared' | 'downloaded' | 'cancelled';

/** Triggers a browser download of `blob` as `fileName`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves text as a file. Uses the Web Share API when it can share files (mobile), otherwise
 * downloads. A user-cancelled share returns `'cancelled'`; other share errors fall back to download.
 */
export async function saveTextFile(
  text: string,
  fileName: string,
  mime = 'application/json',
): Promise<SaveResult> {
  const blob = new Blob([text], { type: mime });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share && nav.canShare && typeof File !== 'undefined') {
    const file = new File([blob], fileName, { type: mime });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: fileName });
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}
