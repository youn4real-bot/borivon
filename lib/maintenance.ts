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

export type FreezeDecision = "pass" | "block" | "skip-cron";

/**
 * What the middleware does with one request while the freeze flag is on.
 * (With the flag off the middleware never calls this.)
 */
export function freezeDecision(method: string, pathname: string): FreezeDecision {
  if (!(pathname === "/api" || pathname.startsWith("/api/"))) return "pass";
  if (isHealthPath(pathname)) return "pass";
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
