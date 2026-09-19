/**
 * The WRITE FREEZE for the final Supabase → D1 copy.
 *
 * The last copy of the database has to be taken while nothing is changing it:
 * a document approved, a message sent or a lead captured between "export
 * started" and "D1 answers" would exist only in Supabase and silently vanish at
 * the flip. MAINTENANCE_WRITES="1" closes that window at two layers:
 *
 *   • middleware.ts answers every mutating /api/* request with a 503 whose body
 *     the portal recognises and explains in the reader's language (LAW #19),
 *   • lib/d1/serviceFetch.ts refuses mutating PostgREST requests on the service
 *     client, so a write that does not come through /api (a GET route that also
 *     writes, the Telegram bot, a cron invoked by hand) cannot slip past either.
 *
 * GETs keep working — the portal stays readable for the ten minutes it takes.
 * OFF unless the var is exactly "1"; nothing here changes the live site until
 * the orchestrator sets it.
 *
 * Pure and dependency-free on purpose: middleware.ts (edge bundle), the client
 * notice (browser bundle) and the tests all import it.
 */

/** Only these methods change anything. HEAD/OPTIONS/GET pass untouched. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/** The flag, read at call time. Anything but exactly "1" is "not frozen". */
export function writesFrozen(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAINTENANCE_WRITES === "1";
}

/**
 * How long the client is told to wait. The final copy (export → import →
 * parity) measured in minutes, not hours; ten keeps a retrying client polite
 * without making a nurse give up.
 */
export const MAINTENANCE_RETRY_AFTER_SEC = 600;

/**
 * The code the service client's freeze answers a refused database write with
 * (lib/d1/serviceFetch.ts): Postgres' own "read-only transaction". A route that
 * must not lose what it was saving (app/api/leads) checks for exactly this.
 */
export const FROZEN_WRITE_CODE = "25006";

export function isWriteFrozenError(err: { code?: string | null } | null | undefined): boolean {
  return err?.code === FROZEN_WRITE_CODE;
}

/** The code the client keys off. Never shown to a person. */
export const MAINTENANCE_CODE = "maintenance";

/** One message, three languages (LAW #19). Shared by the 503 body and the portal notice. */
export const MAINTENANCE_MESSAGES = {
  fr: "Maintenance en cours : l'enregistrement est suspendu pendant quelques minutes. Vos données sont en sécurité, réessayez bientôt.",
  en: "Maintenance in progress: saving is paused for a few minutes. Your data is safe, please try again shortly.",
  de: "Wartungsarbeiten: Speichern ist für einige Minuten pausiert. Ihre Daten sind sicher, bitte versuchen Sie es gleich erneut.",
} as const;

export type MaintenanceLang = keyof typeof MAINTENANCE_MESSAGES;

/**
 * Routes that stay open while writes are frozen, and why:
 *   /api/health     — the uptime monitor and the cutover script probe it; a 503
 *                     here would page someone for a planned pause.
 *   /api/cron/*     — never 503'd (cf-worker.ts would read the 503 as a failed job
 *                     and alert the founder every minute); instead middleware
 *                     answers them "skipped" without running the route, and
 *                     scheduled() does not dispatch at all. See cronSkipBody().
 */
export function isHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/health/");
}

export function isCronPath(pathname: string): boolean {
  return pathname === "/api/cron" || pathname.startsWith("/api/cron/");
}

/**
 *   /api/leads      — the homepage funnel. A prospect shown "try again shortly"
 *                     usually just leaves, and a lost lead is the one loss this
 *                     codebase does not accept. So the route still runs: the
 *                     service client refuses its database write (the second
 *                     layer, so the copy stays exact), and the route hands the
 *                     lead to the founder over Telegram instead
 *                     (app/api/leads/route.ts). /api/book is NOT exempt: a
 *                     booking also creates a calendar event and reminders that
 *                     cannot be half-done — docs/cutover-runbook.md names it.
 */
export function isFreezeTolerantPath(pathname: string): boolean {
  return pathname === "/api/leads";
}

/**
 * POSTs THAT ONLY READ — they pass while writes are frozen.
 *
 * The freeze decides on the HTTP METHOD, which is the right default: almost
 * every POST here saves something. But a handful of routes are POSTs purely
 * because they carry a body (a typed query, a CV payload), and blocking those
 * makes a ten-minute planned pause look like a broken site: the admin's search
 * bar and filters answer 503, and every "download the PDF" button fails. None
 * of them changes a row, so none of them can cost the copy anything.
 *
 * Each entry was verified by reading the route. A route is listed ONLY if it
 * writes no row, mints no durable token and sends no mail. `withWriteFreeze`
 * (lib/d1/serviceFetch.ts) stays the backstop underneath: if one of these ever
 * grows a write, the service client refuses it rather than letting it through.
 *
 * Deliberately NOT listed, though they look read-only:
 *   /api/portal/classroom/token   — writes nothing, but hands out a 3-hour
 *       LiveKit credential, and the session it opens writes attendance
 *       telemetry that the freeze then refuses. A class that half-records is
 *       worse than a class that says "paused"; it is tester-gated anyway.
 *   /api/portal/admin/cv-autofill — returns a draft it never saves, so the only
 *       thing it can produce is work the frozen autosave will refuse a moment
 *       later. Saying "paused" up front is kinder than saying it after typing.
 *   /api/portal/verify-turnstile  — a pure proxy to Cloudflare's siteverify,
 *       but nothing in the app calls it (CAPTCHA is off), so the freeze can
 *       never reach it and listing it would only widen the hole.
 */
const READ_ONLY_POSTS = new Set([
  // The admin panel's whole way in. The bar POSTs the typed query; the model
  // only fills a filter and the results come from a read. 503 here reads as
  // "the portal is down" — it is the first thing the founder touches.
  "/api/portal/admin/search",
  // The Booking.com-style facets behind the same bar: counts + matches, no AI,
  // no write. Blocked, every filter chip fails while the list still shows.
  "/api/portal/admin/facets",
  // The three PDF generators: each renders from the body (plus a profile read)
  // and streams the bytes back. Nothing is stored — the candidate's browser
  // receives the file, and the upload that would save it is a separate route
  // that stays frozen.
  "/api/portal/cv/generate",
  "/api/portal/letter/generate",
  "/api/portal/me/passport-data-pdf",
  "/api/portal/admin/passport-data-pdf",
  // "Where is everyone in their German B2" — a summary report rendered from
  // reads, scoped by LAW #25. Same family as the generators above.
  "/api/portal/admin/b2-report",
  // The signup form's "is this address already registered" check. It only
  // lists auth users. It matters during the freeze because registration itself
  // does NOT come through /api (the browser calls Supabase auth directly, and
  // auth is not part of the copy) — so signup keeps working, and a 503 here
  // would break the form in front of it for no reason at all.
  "/api/portal/check-email",
]);

export function isReadOnlyPostPath(pathname: string): boolean {
  return READ_ONLY_POSTS.has(pathname);
}

/** The exempt paths, for the runbook and the tests. */
export function readOnlyPostPaths(): string[] {
  return [...READ_ONLY_POSTS];
}

export type FreezeDecision = "pass" | "block" | "skip-cron";

/**
 * What the middleware does with one request while the freeze flag is on.
 * (With the flag off the middleware never calls this.)
 */
export function freezeDecision(method: string, pathname: string): FreezeDecision {
  if (!(pathname === "/api" || pathname.startsWith("/api/"))) return "pass";
  if (isHealthPath(pathname) || isFreezeTolerantPath(pathname)) return "pass";
  // A POST that only reads is not a write, whatever the method says.
  if (isReadOnlyPostPath(pathname)) return "pass";
  // Cron routes are GETs that WRITE (reminders, chases, briefings logging what
  // they sent). Skipping them whatever the method is the only way they do no
  // work during the copy.
  if (isCronPath(pathname)) return "skip-cron";
  return isMutatingMethod(method) ? "block" : "pass";
}

/** Best guess at the reader's language from Accept-Language; French is the site default. */
export function pickLang(acceptLanguage: string | null | undefined): MaintenanceLang {
  const raw = (acceptLanguage ?? "").toLowerCase();
  // First listed tag wins — the browser orders them by preference.
  for (const part of raw.split(",")) {
    const tag = part.trim().slice(0, 2);
    if (tag === "de" || tag === "fr" || tag === "en") return tag;
  }
  return "fr";
}

export type MaintenanceBody = {
  error: string;
  code: typeof MAINTENANCE_CODE;
  retryAfter: number;
  messages: typeof MAINTENANCE_MESSAGES;
};

/**
 * The 503 body. `error` is already localised because most portal call sites
 * surface `json.error` verbatim (e.g. the chat composer); `messages` carries all
 * three so the client can match the language the portal is set to, which is not
 * always the browser's.
 */
export function maintenanceBody(lang: MaintenanceLang): MaintenanceBody {
  return {
    error: MAINTENANCE_MESSAGES[lang],
    code: MAINTENANCE_CODE,
    retryAfter: MAINTENANCE_RETRY_AFTER_SEC,
    messages: MAINTENANCE_MESSAGES,
  };
}

/** A plain Response, so the middleware and the tests need nothing from next/server. */
export function maintenanceResponse(acceptLanguage: string | null | undefined): Response {
  return new Response(JSON.stringify(maintenanceBody(pickLang(acceptLanguage))), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(MAINTENANCE_RETRY_AFTER_SEC),
      "cache-control": "no-store",
    },
  });
}

/**
 * A cron hit during the freeze: 200 so nothing alerts, a body that says plainly
 * nothing ran, so a human curling it is not misled.
 */
export function cronSkipResponse(): Response {
  return new Response(JSON.stringify({ ok: true, skipped: MAINTENANCE_CODE }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Does this parsed JSON body come from the freeze? (Client side.) */
export function isMaintenanceBody(json: unknown): json is MaintenanceBody {
  return !!json && typeof json === "object" && (json as { code?: unknown }).code === MAINTENANCE_CODE;
}

/**
 * Is this failed upload the write freeze rather than a bad file?
 *
 * @uppy/xhr-upload's TYPES say the third argument of "upload-error" is
 * `{ status, body }`, but the RUNTIME emits the raw XMLHttpRequest
 * (xhr-upload/lib/index.js: `emit("upload-error", file, buildResponseError(...),
 * request)`). Reading `body` there is always undefined, so the maintenance
 * answer would never be recognised and this whole fix would be dead code on
 * switch night. Read both shapes, and parse the body when it is text.
 */
export function isMaintenanceUploadError(response: unknown): boolean {
  const r = response as { status?: number; body?: unknown; responseText?: string } | undefined;
  if (!r || r.status !== 503) return false;
  let json: unknown = r.body ?? r.responseText;
  if (typeof json === "string") {
    try { json = JSON.parse(json); } catch { return false; }
  }
  return isMaintenanceBody(json);
}

/** The DOM event components/MaintenanceNotice.tsx listens for. */
export const MAINTENANCE_EVENT = "bv:maintenance";

/**
 * Client side, at a save path: is this failed answer the freeze's 503? If so,
 * show the portal's calm notice and return true, so the caller skips its own
 * "failed" handling (the document upload would otherwise retry twice into the
 * pause and end on "upload failed").
 *
 * Called explicitly where a save can hit the freeze — never by patching
 * window.fetch: a global patch would ship to every visitor of every page while
 * the flag is off, which is exactly what "off by default" rules out.
 * `body` is the raw text (an XHR's responseText) or an already parsed body.
 */
export function reportIfMaintenance(status: number, body: unknown): boolean {
  if (status !== 503) return false;
  let json = body;
  if (typeof body === "string") {
    try { json = JSON.parse(body); } catch { return false; }
  }
  if (!isMaintenanceBody(json)) return false;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT));
  }
  return true;
}
