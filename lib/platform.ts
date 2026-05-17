/**
 * iPhone/iPad detection (client-side only).
 *
 * Every browser on iOS is WebKit (Safari, Chrome/CriOS, Firefox/FxiOS,
 * Edge…), so this is an OS check, not a Safari check. iPadOS reports as
 * "MacIntel" with a touch screen, so that case is covered too.
 *
 * Used to branch the PDF preview + every file download onto the iOS-safe
 * path (native PDF frame; server `?dl=1` attachment downloads). Keep this as
 * the SINGLE source of truth — do not re-inline the regex.
 */
export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iP(hone|ad|od)/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
