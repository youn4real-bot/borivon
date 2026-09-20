/**
 * Small decision cores lifted out of app/portal/admin/page.tsx.
 *
 * That page is a 9,000-line client component, so every rule buried in it is
 * unreachable from the test suite: the failure paths are React state writes
 * into JSX and vitest runs in plain Node with no jsdom. The rules here are the
 * ones where getting the answer wrong is expensive, so they live where they can
 * actually be driven, one input at a time.
 */

/**
 * Did the "which agencies can see this candidate" read leave the answer
 * UNKNOWN?
 *
 * `GET /api/portal/admin/partner-share` used to be treated as all-or-nothing:
 * any non-OK response cleared partnerOrgs, and an empty partnerOrgs renders no
 * share buttons at all — indistinguishable from a candidate no agency has ever
 * been sent. The founder then answers "can Calmaroi see her?" from a blank
 * space that means "I could not check", and a partner's API access is granted
 * or withheld on that guess.
 *
 * 403 is the one status that genuinely means "none of your business, and that
 * is the final answer": the route refuses agency admins outright, because
 * letting a partner's own admin press Send-to would let them grant themselves
 * candidates (LAW #25), and it refuses candidates outside the caller's scope.
 * For those callers the control is absent by design and a warning on every
 * dossier would be noise.
 *
 * @param status HTTP status, or null when the request never completed
 *               (offline, DNS, the Worker never answered).
 */
export function shareReadIsUnknown(status: number | null): boolean {
  if (status === null) return true;   // nothing came back — nothing is known
  if (status === 403) return false;   // refused on purpose; the absence IS the answer
  return status < 200 || status > 299;
}
