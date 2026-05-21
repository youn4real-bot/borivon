/**
 * Shared helpers for the live-collab presence channels used by the CV
 * builder and the cover-letter editor.
 *
 * The privacy boundary is the same in both surfaces:
 *   • Main channel  (cv-collab-<id> / letter-collab-<id>)
 *       — candidate + admins subscribe
 *       — admin presence is SCRUBBED (id + role only) so the candidate's
 *         client never receives admin email / displayName / photo
 *   • Admin side channel  (cv-collab-admins-<id> / letter-collab-admins-<id>)
 *       — only admins + sub_admins subscribe
 *       — admin presence carries the FULL identity (email + displayName +
 *         photo) so admin↔admin avatars can show real photos in the
 *         floating presence row
 *
 * Keeping both helpers here so a future refactor (e.g. switching to broadcast
 * + ack rather than presence) only has to touch one file.
 */

import type { CollabPeer } from "@/components/CvCollabPresence";

/**
 * Build the payload an admin tracks on the MAIN channel. Strips email,
 * displayName, and photo when the sender is an admin / sub-admin so the
 * candidate (who also subscribes to this channel) can't learn anything
 * about which admin is editing.
 *
 * Candidate senders keep their full info because their own client
 * already has it.
 */
export function scrubPresencePayload(self: CollabPeer, editing: boolean) {
  const base = {
    id:        self.id,
    role:      self.role,
    editingAt: editing ? Date.now() : 0,
  };
  const isAdminSender = self.role === "admin" || self.role === "sub_admin";
  if (isAdminSender) return base;
  return {
    ...base,
    email:       self.email,
    displayName: self.displayName,
    photo:       self.photo,
  };
}

/**
 * Full-identity payload an admin tracks on the ADMIN side channel. Only
 * other admins / sub-admins ever receive this — candidate clients never
 * subscribe to the side channel, so the PII payload doesn't reach them.
 */
export function fullPresencePayload(self: CollabPeer) {
  return {
    id:          self.id,
    role:        self.role,
    email:       self.email,
    displayName: self.displayName,
    photo:       self.photo ?? null,
    editingAt:   0,
  };
}

export function isAdminRole(role: CollabPeer["role"] | null | undefined): boolean {
  return role === "admin" || role === "sub_admin";
}
