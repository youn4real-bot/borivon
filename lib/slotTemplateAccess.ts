/**
 * lib/slotTemplateAccess.ts — who may download a document slot's blank template.
 *
 * Pure decision core (no IO), so the rule is unit-testable and can't drift as the
 * route around it changes. LAW #25 / LAW #34: slot templates are scoped contracts
 * — an agency's or a single site's paperwork must never be readable by guessing a
 * slotId.
 *
 * The subtle part is EMPLOYER scope: an employer-scoped row keeps `org_id` NULL,
 * so a naive "org_id is null ⇒ global" test silently classifies every site's
 * private template as public. Both dimensions are checked explicitly here.
 */

export type SlotTemplateScope = {
  /** phase_slots.org_id — the agency this template belongs to, if any. */
  orgId: string | null;
  /** phase_slots.employer_id — the site it belongs to, if any. */
  employerId: string | null;
  /** employers.agency_id of that site — which agency the site rolls up to. */
  employerAgencyId?: string | null;
};

export type SlotTemplateViewer = {
  /**
   * Staff standing:
   *   "all"      supreme admin, or a true Borivon-HQ sub-admin — unrestricted.
   *   string[]   an ORG-SCOPED staff account (agency admin / org member): the
   *              agencies they actually administer.
   *   null       not staff (a candidate).
   *
   * This is deliberately NOT a boolean. Every org member gets a `sub_admins` row,
   * so "is there a sub_admins row for this email" is true for all agency-side
   * accounts — treating that as staff let an admin at one agency download a
   * COMPETING agency's contract templates by passing its slotId. Slot ids are not
   * secret (documents.file_type IS the slot id), so this was reachable.
   */
  staff: "all" | readonly string[] | null;
  /** candidate_profiles.employer_id — the site they're placed at. */
  employerId: string | null;
  /** employers.agency_id of that site — the agency it rolls up to. */
  employerAgencyId: string | null;
  /** Agencies the candidate has an APPROVED candidate_organizations link to. */
  approvedOrgIds: readonly string[];
};

export function canReadSlotTemplate(slot: SlotTemplateScope, viewer: SlotTemplateViewer): boolean {
  // Borivon HQ sees everything.
  if (viewer.staff === "all") return true;

  // Truly global (declared for everyone) → any authenticated user.
  if (!slot.orgId && !slot.employerId) return true;

  // Org-scoped STAFF: their own agencies' documents, and the sites under them.
  // Never another agency's, and never a site outside their agencies.
  if (Array.isArray(viewer.staff)) {
    if (slot.orgId && viewer.staff.includes(slot.orgId)) return true;
    if (slot.employerAgencyId && viewer.staff.includes(slot.employerAgencyId)) return true;
    return false;
  }

  // CANDIDATE. Site-scoped → only someone actually placed at that site.
  if (slot.employerId && viewer.employerId && viewer.employerId === slot.employerId) return true;

  // Agency-scoped → an approved link to that agency, or placement at one of its sites.
  if (slot.orgId) {
    if (viewer.approvedOrgIds.includes(slot.orgId)) return true;
    if (viewer.employerAgencyId && viewer.employerAgencyId === slot.orgId) return true;
  }

  return false;
}
