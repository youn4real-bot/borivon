/**
 * Downloading a candidate's profile photo from the admin panel.
 *
 * The photo lives in Supabase Storage, on a DIFFERENT origin to the portal. That
 * matters: the HTML `download` attribute is ignored on a cross-origin link, so
 * `<a href={photoUrl} download>` silently opens the image in a new tab instead
 * of saving it, and on iOS it just replaces the page. The bytes have to be
 * fetched and handed to the browser as a same-origin blob, which the bucket
 * allows (it answers `Access-Control-Allow-Origin: *`).
 */

/**
 * The house filename rule: German umlauts transliterate, everything else that
 * is not a-z/0-9 collapses to an underscore.
 *
 * No Unicode-normalisation pass here on purpose. Stripping accents "properly"
 * needs a combining-mark character class, which is invisible in an editor and
 * gets mangled by the next tool that touches the file; the catch-all below
 * already turns any leftover accented letter into a separator, which is all the
 * filename needs.
 */
function slugifyGerman(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * The saved filename, matching the convention every other candidate file uses:
 * `<firstname>_<lastname>_pflegekraft_foto.<ext>`.
 *
 * The extension comes from the URL rather than a guess: a WebP saved as .jpg
 * opens as a broken file on Windows. Anything unrecognised falls back to .jpg,
 * which is what the upload route stores by default.
 */
export function profilePhotoFileName(fullName: string, photoUrl: string): string {
  const base = slugifyGerman(fullName) || "kandidat";
  // Strip the cache-busting ?t=... before reading the extension.
  const path = (photoUrl || "").split("?")[0].toLowerCase();
  const m = path.match(/\.(png|webp|gif|jpe?g)$/);
  const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "jpg";
  return `${base}_pflegekraft_foto.${ext}`;
}

/**
 * Fetch the image and save it. Returns false when the bytes could not be
 * retrieved, so the caller can say so instead of appearing to do nothing — a
 * download button that silently fails is worse than one that is not there.
 */
export async function downloadProfilePhoto(photoUrl: string, fullName: string): Promise<boolean> {
  try {
    const res = await fetch(photoUrl, { mode: "cors", credentials: "omit" });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false; // an empty body would save a 0-byte file
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = profilePhotoFileName(fullName, photoUrl);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on a later tick: revoking synchronously can cancel the save in
    // Safari before it has finished reading the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return true;
  } catch {
    return false;
  }
}
