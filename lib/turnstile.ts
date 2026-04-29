/**
 * Cloudflare Turnstile — typed wrapper.
 *
 * Centralises the `window` callback contract used by the Turnstile embed
 * widget so consumers don't have to sprinkle `window as any` casts.
 *
 * Usage in a component:
 *   useEffect(() => {
 *     const cleanup = registerTurnstile({
 *       onOk:   tok => setToken(tok),
 *       onExp:  () => setToken(null),
 *       onErr:  () => setToken(null),
 *     });
 *     return cleanup;
 *   }, []);
 */

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export const TURNSTILE_SCRIPT_ID  = "cf-ts-script";
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export const TURNSTILE_CB_OK  = "__bvTurnstileOk"  as const;
export const TURNSTILE_CB_EXP = "__bvTurnstileExp" as const;
export const TURNSTILE_CB_ERR = "__bvTurnstileErr" as const;

interface TurnstileWindow {
  [TURNSTILE_CB_OK]?:  (token: string) => void;
  [TURNSTILE_CB_EXP]?: () => void;
  [TURNSTILE_CB_ERR]?: () => void;
}

/** Type-safe view of the global window for Turnstile callbacks. */
function turnstileWindow(): TurnstileWindow {
  return window as unknown as TurnstileWindow;
}

/** Inject the Turnstile script tag once, idempotently. */
function ensureScriptLoaded() {
  if (typeof document === "undefined") return;
  if (document.getElementById(TURNSTILE_SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = TURNSTILE_SCRIPT_ID;
  s.src = TURNSTILE_SCRIPT_SRC;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

interface RegisterOpts {
  onOk:  (token: string) => void;
  onExp: () => void;
  onErr: () => void;
}

/**
 * Register the three callbacks the Turnstile embed expects on `window`,
 * inject the script, and return a cleanup that detaches them. Returns a
 * no-op cleanup when SITE_KEY isn't configured (e.g. local dev).
 */
export function registerTurnstile({ onOk, onExp, onErr }: RegisterOpts): () => void {
  if (!TURNSTILE_SITE_KEY) return () => undefined;
  if (typeof window === "undefined") return () => undefined;

  const w = turnstileWindow();
  w[TURNSTILE_CB_OK]  = onOk;
  w[TURNSTILE_CB_EXP] = onExp;
  w[TURNSTILE_CB_ERR] = onErr;
  ensureScriptLoaded();

  return () => {
    try {
      delete w[TURNSTILE_CB_OK];
      delete w[TURNSTILE_CB_EXP];
      delete w[TURNSTILE_CB_ERR];
    } catch {
      /* deletion isn't allowed on every host — ignore */
    }
  };
}
