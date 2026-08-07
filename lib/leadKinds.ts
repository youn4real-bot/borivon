/**
 * Which lead kinds describe a PERSON Borivon could place, and which describe a
 * counterparty.
 *
 * The homepage funnel (components/Funnel.tsx) emits five kinds, and the Leads
 * page gated its "Add to pool" button on `kind === "nurse"` — a sixth kind that
 * only the booking path and the bot ever mint. So for every lead that arrived
 * through the website the button simply was not rendered, and the whole
 * lead → pool hop was unreachable. The live table proves it: of eleven rows,
 * four are synthetic health-check rows and not one carries `kind = "nurse"`.
 *
 * The one that matters is saadiajaini99@gmail.com, 28 July, `kind = "work"`
 * with `field = "pflege"` — a nurse who used the "I want to work in Germany"
 * path, sat in the list for weeks, and could not be added to the pool at all.
 *
 * What each kind actually is, read off the funnel's submit handlers:
 *   person       an individual, entering via the German-course path (carries `level`)
 *   work         an individual who wants to WORK in Germany (carries `field`, e.g. "pflege")
 *   nurse        minted by the booking flow and the bot — the original, legacy kind
 *   fachkraefte  an EMPLOYER asking for staff (carries `sector` / `positions` / `city`)
 *   org          an organisation asking about training
 *   general      an unclassified message
 *
 * The first three are people. The last three are counterparties: turning one of
 * them into a candidate would create an auth account for a clinic, which is why
 * the button must stay hidden there.
 */

/** Lead kinds that represent an individual who can become a pool candidate. */
export const PLACEABLE_LEAD_KINDS = ["nurse", "work", "person"] as const;

export type PlaceableLeadKind = (typeof PLACEABLE_LEAD_KINDS)[number];

/** True when a lead of this kind may be converted into a pool candidate. */
export function isPlaceableLead(kind: string | null | undefined): boolean {
  return PLACEABLE_LEAD_KINDS.includes(String(kind ?? "").trim().toLowerCase() as PlaceableLeadKind);
}
