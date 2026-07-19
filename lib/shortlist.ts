/**
 * Employer-shortlist helpers (SERVER ONLY).
 *
 * Builds the summary card shown for each candidate on a shortlist — the exact
 * subset an employer needs to say "yes, interview these": name, photo, profession,
 * city, B2 stage, years of experience, verification, and document-completeness
 * counts. Deliberately NO contact details, NO passport bytes, NO raw documents —
 * the public shared view exposes only these summary fields.
 */
import { getServiceSupabase } from "@/lib/supabase";

export type ShortlistCandidateSummary = {
  userId: string;
  name: string;
  email: string;            // admin view only — the public route strips this
  photo: string | null;
  verified: boolean;
  nationality: string | null;
  city: string | null;
  profession: string | null; // nursing_specialty key (label resolved client-side)
  b2Stage: string | null;
  yearsExperience: number | null;
  docCount: number;
  docsOk: number;
  docsPending: number;
  hasCvDraft: boolean;
};

type ProfRow = {
  user_id: string;
  manually_verified: boolean | null;
  profile_photo: string | null;
  nationality: string | null;
  city_of_residence: string | null;
  nursing_specialty: string | null;
  b2_stage: string | null;
  years_experience: number | null;
  cv_draft: unknown;
};

/** Unguessable share token (48 hex chars) using Web Crypto (works on Node + Workers). */
export function genShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build summary cards for a (small, bounded) set of candidate user_ids. */
export async function getCandidateSummaries(userIds: string[]): Promise<Record<string, ShortlistCandidateSummary>> {
  const out: Record<string, ShortlistCandidateSummary> = {};
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const db = getServiceSupabase();

  // Names/emails from auth (auth.users isn't on PostgREST). Shortlists are small,
  // so a per-id getUserById is fine.
  const nameMap: Record<string, { name: string; email: string }> = {};
  await Promise.all(ids.map(async (uid) => {
    try {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data?.user) {
        const full = (data.user.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined;
        nameMap[uid] = { name: full ?? data.user.email ?? "—", email: data.user.email ?? "" };
      }
    } catch { /* skip */ }
  }));

  const { data: profs } = await db
    .from("candidate_profiles")
    .select("user_id, manually_verified, profile_photo, nationality, city_of_residence, nursing_specialty, b2_stage, years_experience, cv_draft")
    .in("user_id", ids);
  const profById = new Map<string, ProfRow>();
  for (const p of (profs ?? []) as ProfRow[]) profById.set(p.user_id, p);

  const { data: docs } = await db.from("documents").select("user_id, status").in("user_id", ids);
  const docAgg: Record<string, { count: number; ok: number; pending: number }> = {};
  for (const d of (docs ?? []) as { user_id: string; status: string }[]) {
    const a = (docAgg[d.user_id] ??= { count: 0, ok: 0, pending: 0 });
    a.count++;
    if (d.status === "approved") a.ok++;
    else if (d.status === "pending") a.pending++;
  }

  for (const uid of ids) {
    const p = profById.get(uid);
    const a = docAgg[uid] ?? { count: 0, ok: 0, pending: 0 };
    out[uid] = {
      userId: uid,
      name: nameMap[uid]?.name ?? "—",
      email: nameMap[uid]?.email ?? "",
      photo: p?.profile_photo ?? null,
      verified: p?.manually_verified === true,
      nationality: p?.nationality ?? null,
      city: p?.city_of_residence ?? null,
      profession: p?.nursing_specialty ?? null,
      b2Stage: p?.b2_stage ?? null,
      yearsExperience: typeof p?.years_experience === "number" ? p.years_experience : null,
      docCount: a.count,
      docsOk: a.ok,
      docsPending: a.pending,
      hasCvDraft: !!p?.cv_draft,
    };
  }
  return out;
}

/** Strip the identifying fields (email + the auth user_id) for the public view —
 *  the shared page needs none of them (it keys off array index). */
export function toPublicSummary(s: ShortlistCandidateSummary): Omit<ShortlistCandidateSummary, "email" | "userId"> {
  const { email: _email, userId: _userId, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}
