/**
 * The login / registration page's network guard.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT: a nurse fills in the registration form
 * on Moroccan mobile data, taps "Sign up", and the button turns into a grey
 * "…" and stays there. Not for ten seconds — forever. `handleSubmit` did
 *
 *     setLoading(true);
 *     const checkRes = await fetch(`/api/portal/invite/${code}`);
 *
 * with no try/catch and no deadline, so the handler could not learn that its
 * own request had died: a rejected fetch escaped the handler (nothing ever
 * cleared `loading`), and a fetch that simply never answers — the normal
 * failure mode of a stalled mobile connection, where no error is ever raised —
 * left it awaiting a promise that would not settle. She is looking at the very
 * first screen Borivon ever shows her with no idea whether she now has an
 * account.
 *
 * So every network call on that page goes through one of these two, and every
 * busy flag is cleared in a `finally`. `withTimeout` is for the supabase-js
 * calls, which take no AbortSignal; `fetchWithTimeout` is for our own routes.
 */

/** 20s. Long enough for a slow 3G round trip, short enough that she is told
 *  something while she is still holding the phone. */
export const AUTH_NET_TIMEOUT_MS = 20_000;

/** The message a timed-out call rejects with, so `authErrorMessage` can turn
 *  it into her language instead of a generic "something went wrong". */
export const TIMEOUT_MARK = "bv-net-timeout";

/**
 * Give a promise a deadline.
 *
 * supabase-js's `signUp` / `signInWithPassword` / `verifyOtp` / `resend` /
 * `resetPasswordForEmail` / `getSession` accept no AbortSignal, so racing a
 * timer is the ONLY way to stop a stalled connection from parking the submit
 * handler for the rest of the session. The timer is always cleared — a pending
 * 20s timer would otherwise keep a test process (and a phone's radio) awake
 * long after the work settled.
 */
export function withTimeout<T>(work: Promise<T>, ms: number = AUTH_NET_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alarm = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MARK)), ms);
  });
  return Promise.race([work, alarm]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * `fetch` with a deadline.
 *
 * Aborting matters beyond the UI: without it the dead request stays open on a
 * phone that has already given up on it, and the retry she taps queues behind
 * it. A caller's own `signal` is respected — we only add ours when there is
 * none.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
  ms: number = AUTH_NET_TIMEOUT_MS,
): Promise<Response> {
  if (init?.signal) return fetchImpl(url, init);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a Supabase auth message — or one of our own failures — into something
 * SHE can act on.
 *
 * Signup, login, OTP verify and reset all fell through to `err.message`
 * verbatim outside a two-or-three item allowlist. Everything else landed on
 * her screen in raw English — "For security purposes, you can only request
 * this after 47 seconds", "Email rate limit exceeded", "Password should be at
 * least 6 characters" — in front of a nurse reading French or Arabic, at the
 * one moment she cannot proceed without understanding it. LAW #19 says every
 * visible string exists in all three languages, and a passthrough of an English
 * server message is the same dead end as no message at all.
 *
 * Matched on the shapes Supabase actually returns. Anything genuinely unknown
 * gets a plain, honest fallback in her own language rather than English
 * internals — nothing is silently swallowed either way.
 */
export function authErrorMessage(raw: string, lang: "fr" | "en" | "de"): string {
  const m = (raw || "").toLowerCase();
  const pick = (fr: string, en: string, de: string) => (lang === "de" ? de : lang === "en" ? en : fr);

  // FIRST, before every other branch. A timed-out or aborted call is the one
  // failure that used to have no message at all because the handler never
  // reached a line that could set one. "Too slow" is also different advice
  // from "no network": moving nearer a window helps, retyping the form does not.
  if (new RegExp(`${TIMEOUT_MARK}|timed out|timeout|aborted|abort`).test(m)) {
    return pick("La connexion est trop lente. Vérifiez votre réseau et réessayez.",
      "The connection is too slow. Check your network and try again.",
      "Die Verbindung ist zu langsam. Prüfen Sie Ihr Netz und versuchen Sie es erneut.");
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(m)) {
    return pick("Erreur réseau. Vérifiez votre connexion et réessayez.",
      "Network error. Check your connection and try again.",
      "Netzwerkfehler. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.");
  }
  if (/already registered|already been registered|user already exists/.test(m)) {
    return pick("Cette adresse e-mail a déjà un compte. Connectez-vous plutôt.",
      "That email already has an account. Sign in instead.",
      "Für diese E-Mail existiert bereits ein Konto. Melden Sie sich stattdessen an.");
  }
  if (/invalid login credentials|invalid credentials/.test(m)) {
    return pick("E-mail ou mot de passe incorrect.",
      "Wrong email or password.",
      "E-Mail oder Passwort ist falsch.");
  }
  // "For security purposes, you can only request this after N seconds" + the
  // email rate limit. Both are waits, not failures — say so.
  if (/rate limit|after \d+ seconds|too many requests|security purposes/.test(m)) {
    return pick("Trop de tentatives. Patientez une minute puis réessayez.",
      "Too many attempts. Please wait a minute and try again.",
      "Zu viele Versuche. Bitte warten Sie eine Minute und versuchen Sie es erneut.");
  }
  if (/password.*(at least|should be|too short|weak)/.test(m)) {
    return pick("Choisissez un mot de passe plus long (8 caractères minimum).",
      "Choose a longer password (at least 8 characters).",
      "Wählen Sie ein längeres Passwort (mindestens 8 Zeichen).");
  }
  if (/expired|invalid.*(token|otp|code)|otp.*invalid/.test(m)) {
    return pick("Ce code est incorrect ou a expiré. Demandez-en un nouveau.",
      "That code is wrong or has expired. Ask for a new one.",
      "Dieser Code ist falsch oder abgelaufen. Fordern Sie einen neuen an.");
  }
  if (/email not confirmed|not confirmed/.test(m)) {
    return pick("Confirmez d'abord votre e-mail avec le code envoyé.",
      "Confirm your email first using the code we sent.",
      "Bestätigen Sie zuerst Ihre E-Mail mit dem gesendeten Code.");
  }
  if (/invalid.*email|email.*invalid/.test(m)) {
    return pick("Cette adresse e-mail n'est pas valide.",
      "That email address isn't valid.",
      "Diese E-Mail-Adresse ist ungültig.");
  }
  return pick("Une erreur s'est produite. Veuillez réessayer.",
    "Something went wrong. Please try again.",
    "Etwas ist schiefgelaufen. Bitte erneut versuchen.");
}

/** The message of a thrown value, for handing to `authErrorMessage`. */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "";
}
