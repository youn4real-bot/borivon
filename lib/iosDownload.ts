/**
 * iOS file download trigger.
 *
 * iOS can't download a client blob — every iOS download is an in-gesture
 * anchor click to a same-origin server URL that responds with
 * `Content-Disposition: attachment` (forces the save → native iOS prompt →
 * Files).
 *
 * NextTopLoader attaches a document-level click listener and, for any
 * same-host anchor, briefly flashes its gold progress bar (it does
 * `start(); done()`). A download is NOT a navigation, so that flash is
 * noise. We stop the click event from bubbling to that listener
 * (`stopImmediatePropagation`) WITHOUT `preventDefault`, so the browser
 * still performs the download but the loader never sees the click.
 *
 * `onSettled` (optional): fired once the iOS "Do you want to download …?"
 * sheet appears — i.e. the file is ready. iOS surfaces that moment by
 * blurring the page (window `blur`) / hiding the document
 * (`visibilitychange`) / `pagehide`. We listen for the first of those and
 * call `onSettled` then (with an 8s safety fallback). Used to stop the
 * download spinner exactly when the prompt shows, not on a fixed timer.
 *
 * Single source of truth — every iOS download goes through here.
 */
export function triggerIosDownload(
  href: string,
  filename: string,
  onSettled?: () => void,
): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.addEventListener("click", (e) => e.stopImmediatePropagation());
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 3000);

  if (!onSettled) return;

  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", fire);
    window.removeEventListener("blur", fire);
    clearTimeout(fallback);
    onSettled();
  };
  const onVis = () => { if (document.hidden) fire(); };

  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", fire);
  window.addEventListener("blur", fire);
  // Safety net: if no native event fires (rare), stop the spinner anyway.
  const fallback = setTimeout(fire, 8000);
}
