/**
 * Server-side hardening for candidate-supplied CVData before it is rendered by
 * @react-pdf (CVDocument) or serialized to text (cvDraftToText). Two jobs, both
 * driven by the security review (2026-05):
 *
 *  1. SSRF guard — `photo` is passed to <Image src={data.photo}>, and
 *     @react-pdf's image resolver will `fetch()` ANY non-`data:` URI
 *     server-side (no allowlist, no timeout). A candidate who POSTs
 *     `photo:"http://169.254.169.254/latest/meta-data/…"` (or any internal
 *     host) to /api/portal/cv/generate makes the server issue that request —
 *     a blind SSRF usable to reach cloud metadata / internal services. We drop
 *     `photo` unless it is a valid raster `data:` image URL (same allowlist
 *     used for profile photos, signatures, feed images, org logos).
 *
 *  2. DoS guard — the byte-size cap on the request body does NOT bound ARRAY
 *     LENGTH. ~10k workEntries fit in 2 MB of JSON and force an O(n²) merge in
 *     CVDocument plus a multi-thousand-page render that pins the function's CPU
 *     / memory. We hard-cap every array to limits far beyond any real CV.
 *
 * Mutates and returns the same object; tolerant of malformed input. Apply at
 * EVERY entry point that feeds CVData into a renderer/serializer:
 * cv/generate, cv/visa, cv/text.
 */
import type { CVData } from "@/components/CVDocument";
import { validateImageDataUrl } from "@/lib/validateDataUrl";

// Generous ceilings — a real German CV never approaches these.
const MAX_WORK = 40;
const MAX_EDU = 40;
const MAX_LANGS = 20;
const MAX_NESTED = 30;          // taetigkeiten / departments / additionalSites per entry
const MAX_NATIONALITIES = 10;
const MAX_EDV = 50;

function clamp(v: unknown, max: number): unknown[] | undefined {
  return Array.isArray(v) ? v.slice(0, max) : undefined;
}

export function sanitizeCvData<T extends Partial<CVData>>(data: T): T {
  if (!data || typeof data !== "object") return data;

  // 1. SSRF — only a valid raster data: URL may survive as the photo. A remote
  //    http(s) URL, an SVG, or junk fails validateImageDataUrl → dropped.
  if (data.photo && !validateImageDataUrl(data.photo).ok) {
    data.photo = null;
  }

  // 2. DoS — cap array dimensions (top-level + nested).
  if (Array.isArray(data.workEntries)) {
    data.workEntries = (data.workEntries.slice(0, MAX_WORK) as CVData["workEntries"]).map(w => {
      if (w && typeof w === "object") {
        const t = clamp(w.taetigkeiten, MAX_NESTED);   if (t) w.taetigkeiten = t as string[];
        const d = clamp(w.departments, MAX_NESTED);     if (d) w.departments = d as string[];
        const s = clamp(w.additionalSites, MAX_NESTED); if (s) w.additionalSites = s as NonNullable<CVData["workEntries"][number]["additionalSites"]>;
      }
      return w;
    });
  }
  const edu = clamp(data.eduEntries, MAX_EDU);                       if (edu) data.eduEntries = edu as CVData["eduEntries"];
  const langs = clamp(data.langs, MAX_LANGS);                       if (langs) data.langs = langs as CVData["langs"];
  const nat = clamp(data.additionalNationalities, MAX_NATIONALITIES); if (nat) data.additionalNationalities = nat as string[];
  const edvS = clamp(data.edvSelected, MAX_EDV);                    if (edvS) data.edvSelected = edvS as string[];
  const edvC = clamp(data.edvCustomInputs, MAX_EDV);                if (edvC) data.edvCustomInputs = edvC as string[];

  return data;
}
