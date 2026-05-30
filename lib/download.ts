/**
 * Authenticated file download helpers (client-only).
 *
 * Why this exists: PDF previews fetch the file ONCE into a blob URL when the
 * popup opens. Rotation is persisted to documents.rotation and baked into the
 * bytes server-side by /api/portal/file. If the user rotates while the popup is
 * open, that open-time blob is now STALE — downloading it gives the orientation
 * the file had when opened, not "as left". These helpers always pull FRESH
 * bytes at click time (after any pending rotation PATCH commits) so the
 * download matches what's on screen.
 */

/** Trigger a browser "save as" for an already-fetched object/blob URL. */
export function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Fetch a file from an authed endpoint and save it. Always no-store so any
 * server-side transform (baked rotation) reflects the latest persisted state.
 *
 * @param waitFor optional promise to await before fetching (e.g. the rotation
 *                PATCH chain) so the fresh fetch sees the committed orientation.
 */
export async function downloadAuthedFile(opts: {
  url: string;
  fileName: string;
  token?: string | null;
  waitFor?: Promise<unknown> | null;
}): Promise<void> {
  const { url, fileName, token, waitFor } = opts;
  if (waitFor) { try { await waitFor; } catch { /* persist failed — fetch newest anyway */ } }

  const res = await fetch(url, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const objectUrl = URL.createObjectURL(await res.blob());
  triggerDownload(objectUrl, fileName);
  // Revoke after the download has had time to start.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}
