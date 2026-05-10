/**
 * Shared TypeScript types used across API routes and components.
 *
 * Import with:  import type { Doc, DocStatus, ... } from "@/types";
 *
 * Keep this file as the single source of truth for data shapes.
 * If the DB schema changes, update here first — TypeScript will flag
 * every callsite that needs updating.
 */

// ─────────────────────────── Documents ──────────────────────────────────────

export type DocStatus = "pending" | "approved" | "rejected";

export type Doc = {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: DocStatus;
  feedback: string | null;
  drive_file_id: string | null;
  uploaded_by_admin: boolean;
};

// ─────────────────────────── Users ──────────────────────────────────────────

/** Lightweight user record used in admin views */
export type UserMeta = {
  email: string;
  name: string;
};

// ─────────────────────────── Candidate Profile ───────────────────────────────

export type CandidateProfile = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  sex: string | null;
  nationality: string | null;
  passport_no: string | null;
  passport_expiry: string | null;
  city_of_birth: string | null;
  country_of_birth: string | null;
  issuing_authority: string | null;
  issue_date: string | null;
  address_street: string | null;
  address_number: string | null;
  address_postal: string | null;
  city_of_residence: string | null;
  country_of_residence: string | null;
  passport_status: string | null;
  passport_feedback: string | null;
  marital_status: string | null;
  children_ages: string | null;
};

// ─────────────────────────── Notifications ───────────────────────────────────

export type Notification = {
  id: string;
  user_id: string;
  doc_id: string | null;
  doc_name: string | null;
  doc_type: string | null;
  action: string;
  feedback: string | null;
  read: boolean;
  created_at: string;
};

// ─────────────────────────── Messages ────────────────────────────────────────

export type MessageKind = "message" | "bug";
export type MessageSender = "candidate" | "admin";

export type Message = {
  id: string;
  user_id: string;
  sender: MessageSender;
  body: string;
  attachment: string | null;
  kind: MessageKind | null;
  read: boolean;
  created_at: string;
};

// ─────────────────────────── Public Profile ──────────────────────────────────

export type PublicProfile = {
  slug: string;
  name: string;
  initial: string;
  cityOfResidence: string | null;
  countryOfResidence: string | null;
  nationality: string | null;
  verified: boolean;
  isAdmin: boolean;
};
