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

/**
 * iOS download when the download token MIGHT NOT HAVE MINTED YET.
 *
 * Every iOS download needs a `dlt` token in the URL (WebKit carries no
 * Authorization header on a navigation). The token is pre-minted on mount by
 * useDlToken precisely so the anchor click can stay inside the tap gesture —
 * and when it is ready, that fast path is what runs here, unchanged.
 *
 * The problem was the other branch. Four call sites did
 * `if (!dlt) { clearSpinner(); return; }` — a completely silent no-op. On a
 * Cloudflare cold start, or after one flaked mint on mobile data, the button
 * simply did nothing: no error, no retry, no explanation. She taps Download on
 * her diploma, the spinner blinks, and nothing happens. Twice. Then she messages
 * support saying the portal is broken.
 *
 * Recovering needs an await, and WebKit blocks an anchor click issued after an
 * await because the tap gesture is over by then. But it does NOT block a window
 * that was opened SYNCHRONOUSLY inside the gesture and navigated later. So:
 * open a blank tab first, mint, then point it at the attachment URL. The
 * Content-Disposition header makes iOS show its save sheet and the tab closes
 * itself.
 *
 * `onError` is mandatory rather than optional on purpose — the whole bug was
 * that failing quietly was the easy thing to write.
 */
export async function triggerIosDownloadWithToken(opts: {
  /** Given a token, produce the final download URL. */
  href: (token: string) => string;
  filename: string;
  /** Already-minted token, or null when it has not landed yet. */
  token: string | null;
  /** Mints a fresh token. Normally `() => mintDlToken(authToken)`. */
  mint: () => Promise<string>;
  /** Called once the save sheet appears or the attempt gives up. */
  onSettled: () => void;
  /** Called when the download genuinely could not start. Must be visible. */
  onError: () => void;
}): Promise<void> {
  const { href, filename, token, mint, onSettled, onError } = opts;

  // FAST PATH — token in hand, click stays inside the gesture. Unchanged.
  if (token) {
    triggerIosDownload(href(token), filename, onSettled);
    return;
  }

  // SLOW PATH — open the tab NOW, while the gesture is still live.
  const w = window.open("", "_blank");
  try {
    const fresh = await mint();
    const url = href(fresh);
    if (w && !w.closed) {
      w.location.href = url;
      // The save sheet takes over; the now-blank tab is just litter.
      setTimeout(() => { try { w.close(); } catch { /* already gone */ } }, 4000);
      setTimeout(onSettled, 1500);
    } else {
      // Popup blocked. Try the anchor anyway — worst case it no-ops, which is
      // no worse than the old behaviour, and the spinner still clears.
      triggerIosDownload(url, filename, onSettled);
    }
  } catch {
    try { w?.close(); } catch { /* already gone */ }
    onError();
    onSettled();
  }
}
