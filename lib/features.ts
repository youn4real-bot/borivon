/**
 * Global feature flags.
 *
 * SIGN_FILL_ENABLED — master switch for the document SIGNING + form-FILLING
 * flows on Bearbeitung/Visum slots (admin/candidate signatures, AcroForm
 * fill, sign-requests). Turned OFF for now: the flows have too many open bugs,
 * so every entry point is hidden for ALL users (candidates, sub-admins, org
 * admins, supreme admin). Slots degrade to plain upload-only. Flip back to
 * true once the sign/fill UX is fixed — nothing was deleted, only gated.
 */
export const SIGN_FILL_ENABLED = false;

/**
 * SHOW_CANDIDATE_TICK — the gold "verified" tick on candidates (it meant the old
 * paid "Premium plan"). Founder 2026-11-13: no consumer plan, no Stripe, the
 * platform is free for everyone, so the tick, its "Premium" popup, the
 * verified celebration and the admin Verifizieren toggle are HIDDEN. Kept, not
 * deleted: it may come back as a badge (e.g. "visa ready"). The black team /
 * organisation ticks are not affected.
 */
export const SHOW_CANDIDATE_TICK = false as boolean;

/** Zero out a slot's sign/fill action flags while SIGN_FILL_ENABLED is off, so
 *  every slot behaves as a plain upload box. Pass any object that may carry the
 *  four flags; returns a shallow copy with them forced false when disabled. */
export function applySignFillGate<T extends {
  admin_signs?: boolean; candidate_signs?: boolean;
  admin_fills?: boolean; candidate_fills?: boolean;
}>(slot: T): T {
  if (SIGN_FILL_ENABLED) return slot;
  return { ...slot, admin_signs: false, candidate_signs: false, admin_fills: false, candidate_fills: false };
}
