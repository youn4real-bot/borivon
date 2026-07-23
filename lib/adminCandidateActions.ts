/**
 * Shared admin candidate-action cores.
 *
 * The supreme-admin can review documents and edit candidate passport/profile
 * data from TWO surfaces now: the web panel (app/api/portal/admin POST/PATCH)
 * AND the Telegram/in-app AI assistant (lib/assistantWrites). To guarantee both
 * do EXACTLY the same thing — same notifications, emails, passport gates,
 * verified-tick, cv_draft propagation (LAW #37), name sync, OCR wipe — the
 * mutation logic lives here, once, and both callers invoke it after their own
 * auth gating.
 *
 * These functions DO NOT authenticate. Callers MUST gate first
 * (requireAdminRole + canActOnCandidate on the web; admin_only +
 * canActOnCandidate at stage AND confirm on the bot). applyDocReview takes an
 * `authorize(ownerUserId)` callback because the doc's owner isn't known until
 * the row is loaded.
 *
 * LAW #20: a rejection must carry non-empty feedback.
 * LAW #37: a passport/identity edit re-propagates into the stored cv_draft.
 * LAW #38: this NEVER ticks the human passport confirmation checkboxes — it only
 *          flips passport_status; the boxes stay a manual human click.
 * LAW #39 is N/A here (no passport bytes are touched — only the DB row/status).
 */
import { getServiceSupabase } from "@/lib/supabase";
import { isPreMatchDoc } from "@/lib/fileKeys";
import { scheduleCandidateMirror } from "@/lib/scheduleMirror";
import { DOC_STATUSES } from "@/lib/constants";
import { ALLOWED_PROFILE_FIELDS } from "@/lib/constants";
import { sendDocApprovedEmail, sendDocRejectedEmail } from "@/lib/email";
import { cvFieldsFromProfile, PASSPORT_DERIVED_COLUMNS, type ProfileLike } from "@/lib/personalData";

type DB = ReturnType<typeof getServiceSupabase>;
export type ActionResult = { ok: true } | { ok: false; error: string };

const SLOT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Review a single document → set status + feedback, then run the full
 * candidate-notification / email / passport-acceptance / verified pipeline.
 * `authorize(ownerUserId)` must resolve true or the call returns 'forbidden'.
 */
export async function applyDocReview(
  db: DB,
  opts: { docId: string; status: string; feedback?: string | null },
  authorize: (ownerUserId: string) => Promise<boolean>,
): Promise<ActionResult> {
  const { docId, status } = opts;
  const feedback = opts.feedback;
  if (!(DOC_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "bad_status" };

  // LAW #20 — rejection must carry non-empty feedback.
  if (status === "rejected") {
    const trimmed = typeof feedback === "string" ? feedback.trim() : "";
    if (!trimmed) return { ok: false, error: "reject_needs_reason" };
  }

  const { data: doc0 } = await db.from("documents").select("user_id").eq("id", docId).maybeSingle();
  if (!doc0) return { ok: false, error: "not_found" };
  if (!(await authorize((doc0 as { user_id: string }).user_id))) return { ok: false, error: "forbidden" };

  const { error } = await db
    .from("documents")
    .update({ status, feedback: typeof feedback === "string" ? feedback : null })
    .eq("id", docId);
  if (error) return { ok: false, error: "write_failed" };

  if (status === "approved" || status === "rejected") {
    const { data: doc } = await db
      .from("documents")
      .select("user_id, file_name, file_type")
      .eq("id", docId)
      .maybeSingle();

    if (doc) {
      let notifDocType = doc.file_type as string;
      if (SLOT_UUID.test(notifDocType)) {
        const { data: slotRow } = await db.from("phase_slots").select("label").eq("id", notifDocType).maybeSingle();
        const slotLabel = (slotRow as { label?: string | null } | null)?.label;
        if (slotLabel) notifDocType = slotLabel;
      }
      const isPassportDoc = /pass/i.test(doc.file_type as string);

      if (status === "approved" && isPassportDoc) {
        await maybeNotifyPassportApproved(db, doc.user_id as string);
      } else {
        await db.from("notifications").insert({
          user_id: doc.user_id,
          doc_id: docId,
          doc_name: doc.file_name,
          doc_type: notifDocType,
          action: status,
          feedback: typeof feedback === "string" ? feedback : null,
          read: false,
        });
        db.auth.admin.getUserById(doc.user_id as string).then(({ data }) => {
          const email = data?.user?.email;
          if (!email) return;
          if (status === "approved") sendDocApprovedEmail(email, doc.file_type as string);
          else sendDocRejectedEmail(email, doc.file_type as string, typeof feedback === "string" ? feedback : null);
        }).catch(() => {});
      }

      if (status === "approved" && isPassportDoc) {
        await maybeGrantVerified(db, doc.user_id as string);
      }
      // AUTO-MIRROR: a pre-match dossier change (approve OR reject) now refreshes
      // the agency's Drive folder automatically — best-effort, after the response,
      // never on the critical path (see lib/scheduleMirror). Post-match / Visum-slot
      // docs are skipped: they don't belong in the "Vor Matching" mirror. This one
      // trigger covers BOTH the web admin route and the AI bot (both call here).
      // The manual "Sync this batch → Drive" button still exists as a full re-sync.
      if (isPreMatchDoc(doc.file_type as string)) scheduleCandidateMirror(doc.user_id as string);
    }
  }

  return { ok: true };
}

/**
 * Apply a candidate_profiles patch (passport/identity/contact + CV-branding
 * flags). Allowlist-filtered, dates normalized, OCR wiped on rejection, then
 * cv_draft propagation (LAW #37) + auth name sync + reject/approve
 * notifications + verified gate. Caller must canActOnCandidate(userId) first.
 */
export async function applyCandidateProfilePatch(
  db: DB,
  opts: { userId: string; profile: Record<string, unknown> },
): Promise<ActionResult> {
  const { userId, profile } = opts;

  const BOOLEAN_FIELDS = new Set(["cv_use_agency_branding", "cv_use_borivon_branding"]);
  const cleanProfile: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (!ALLOWED_PROFILE_FIELDS.has(k)) continue;
    if (BOOLEAN_FIELDS.has(k)) cleanProfile[k] = v === true ? true : v === false ? false : null;
    else cleanProfile[k] = v;
  }
  if (Object.keys(cleanProfile).length === 0) return { ok: false, error: "no_valid_fields" };

  const toIsoDate = (v: unknown): string | null => {
    if (typeof v !== "string") return v == null ? null : (v as string);
    const s = v.trim();
    if (!s) return null;
    const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (de) return `${de[3]}-${de[2]}-${de[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d.getTime())
      ? null
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  for (const dk of ["dob", "issue_date", "passport_expiry"] as const) {
    if (dk in cleanProfile) cleanProfile[dk] = toIsoDate(cleanProfile[dk]);
  }

  const newPassportStatus = cleanProfile.passport_status as string | undefined;

  if (newPassportStatus === "rejected") {
    const OCR_FIELDS = [
      "first_name", "last_name", "dob", "sex",
      "nationality", "passport_no", "passport_expiry",
      "city_of_birth", "country_of_birth",
      "issuing_authority", "issue_date",
      "address_street", "address_number", "address_postal",
      "city_of_residence", "country_of_residence",
      "marital_status", "children_ages",
    ] as const;
    for (const f of OCR_FIELDS) cleanProfile[f] = null;
  }

  let prevPassportStatus: string | null = null;
  if (newPassportStatus === "rejected" || newPassportStatus === "approved") {
    const { data: prior } = await db
      .from("candidate_profiles").select("passport_status").eq("user_id", userId).maybeSingle();
    prevPassportStatus = (prior as { passport_status?: string | null } | null)?.passport_status ?? null;
  }

  const { data: updatedRows, error } = await db
    .from("candidate_profiles").update(cleanProfile).eq("user_id", userId).select("user_id");
  if (error) {
    console.error("[applyCandidateProfilePatch] update failed:", error);
    return { ok: false, error: `Save failed: ${error.message}` };
  }
  if (!updatedRows || updatedRows.length === 0) {
    const { error: insErr } = await db.from("candidate_profiles").insert({ ...cleanProfile, user_id: userId });
    if (insErr) {
      console.error("[applyCandidateProfilePatch] insert failed:", insErr);
      return { ok: false, error: `Save failed: ${insErr.message}` };
    }
  }

  // LAW #37 cv_draft propagation.
  if (PASSPORT_DERIVED_COLUMNS.some((c) => c in cleanProfile)) {
    try {
      const { data: freshRow } = await db
        .from("candidate_profiles")
        .select("cv_draft, first_name, last_name, dob, city_of_birth, country_of_birth, nationality, city_of_residence, country_of_residence, address_postal, address_street, address_number, marital_status, children_ages")
        .eq("user_id", userId)
        .maybeSingle();
      const draft = (freshRow as { cv_draft?: Record<string, unknown> | null } | null)?.cv_draft;
      if (draft && typeof draft === "object") {
        const canonical = cvFieldsFromProfile(freshRow as ProfileLike);
        await db.from("candidate_profiles").update({ cv_draft: { ...draft, ...canonical } }).eq("user_id", userId);
      }
    } catch (e) {
      console.error("[applyCandidateProfilePatch] cv_draft propagation failed (non-fatal):", e);
    }
  }

  // Auth name sync (skipped on rejection — names get wiped there).
  if (newPassportStatus !== "rejected" && ("first_name" in cleanProfile || "last_name" in cleanProfile)) {
    try {
      const { data: cp } = await db
        .from("candidate_profiles").select("first_name, last_name").eq("user_id", userId).maybeSingle();
      const fn = ((cp as { first_name?: string | null } | null)?.first_name ?? "").toString().trim();
      const ln = ((cp as { last_name?: string | null } | null)?.last_name ?? "").toString().trim();
      const full = [fn, ln].filter(Boolean).join(" ");
      await db.auth.admin.updateUserById(userId, {
        user_metadata: { first_name: fn || null, last_name: ln || null, full_name: full || null },
      });
    } catch (e) {
      console.error("[applyCandidateProfilePatch] auth name sync failed (non-fatal):", e);
    }
  }

  if (newPassportStatus === "rejected" && prevPassportStatus !== "rejected") {
    const { data: passDocs } = await db
      .from("documents").select("id, file_name, file_type")
      .eq("user_id", userId).ilike("file_type", "%pass%").order("uploaded_at", { ascending: false }).limit(1);
    const passDoc = passDocs?.[0];
    await db.from("notifications").insert({
      user_id: userId,
      doc_id: passDoc?.id ?? null,
      doc_name: passDoc?.file_name ?? "Passport",
      doc_type: passDoc?.file_type ?? "Passport",
      action: "rejected",
      feedback: (cleanProfile.passport_feedback as string | null) ?? null,
      read: false,
    });
    db.auth.admin.getUserById(userId).then(({ data }) => {
      const email = data?.user?.email;
      if (!email) return;
      sendDocRejectedEmail(email, passDoc?.file_type ?? "Passport", (cleanProfile.passport_feedback as string | null) ?? null);
    }).catch(() => {});
    await db.from("candidate_profiles").update({ placement_ready: false }).eq("user_id", userId);
  }

  if (newPassportStatus === "approved" && prevPassportStatus !== "approved") {
    await maybeNotifyPassportApproved(db, userId);
  }
  if (newPassportStatus === "approved") {
    await maybeGrantVerified(db, userId);
  }

  return { ok: true };
}

// ── Passport-acceptance side effects (moved from app/api/portal/admin) ────────

/** Full passport acceptance (PDF doc + data both approved) → placement_ready +
 *  org-match suggestions. Does NOT grant the gold verified tick. */
async function maybeGrantVerified(db: DB, userId: string) {
  const { data: profile } = await db
    .from("candidate_profiles").select("passport_status").eq("user_id", userId).maybeSingle();
  if (profile?.passport_status !== "approved") return;

  const { data: passDocsRaw } = await db
    .from("documents").select("*") // '*' so a not-yet-migrated superseded_at never errors
    .eq("user_id", userId).ilike("file_type", "%pass%").eq("status", "approved");
  // Ignore ARCHIVED passports (superseded_at set) — a wrong one shouldn't keep them placement-ready.
  const passDocs = (passDocsRaw ?? []).filter((d) => !(d as { superseded_at?: string | null }).superseded_at);
  if (!passDocs.length) return;

  const { data: updated } = await db
    .from("candidate_profiles").update({ placement_ready: true })
    .eq("user_id", userId).not("placement_ready", "is", true).select("user_id");
  if (!updated?.length) return;

  maybeCreateMatches(db, userId).catch((e) => console.warn("[maybeCreateMatches]", e));
}

/** Send the candidate's "passport approved" notification ONLY when BOTH the
 *  passport PDF doc AND the passport data (passport_status) are approved.
 *  Idempotent per acceptance cycle. */
async function maybeNotifyPassportApproved(db: DB, userId: string) {
  const { data: profile } = await db
    .from("candidate_profiles").select("passport_status").eq("user_id", userId).maybeSingle();
  if (profile?.passport_status !== "approved") return;

  const { data: passDocsRaw } = await db
    .from("documents").select("*") // '*' so a not-yet-migrated superseded_at never errors
    .eq("user_id", userId).ilike("file_type", "%pass%").order("uploaded_at", { ascending: false });
  // Latest NON-archived passport (skip superseded_at rows).
  const passDoc = (passDocsRaw ?? []).filter((d) => !(d as { superseded_at?: string | null }).superseded_at)[0] as { id: string; file_name: string | null; file_type: string | null; status: string } | undefined;
  if (!passDoc || passDoc.status !== "approved") return;

  const { data: lastNotif } = await db
    .from("notifications").select("action")
    .eq("user_id", userId).in("action", ["approved", "rejected"]).ilike("doc_type", "%pass%")
    .order("created_at", { ascending: false }).limit(1);
  if (lastNotif?.[0]?.action === "approved") return;

  await db.from("notifications").insert({
    user_id: userId,
    doc_id: passDoc.id,
    doc_name: passDoc.file_name,
    doc_type: passDoc.file_type,
    action: "approved",
    feedback: null,
    read: false,
  });
  db.auth.admin.getUserById(userId).then(({ data }) => {
    const email = data?.user?.email;
    if (email) sendDocApprovedEmail(email, passDoc.file_type as string);
  }).catch(() => {});
}

/** When a candidate becomes placement_ready, insert suggested_matches rows for
 *  each open org requirement not already linked/suggested. */
async function maybeCreateMatches(db: DB, userId: string) {
  const { data: reqs } = await db.from("org_requirements").select("id, org_id").eq("active", true);
  if (!reqs?.length) return;

  const orgToReqId: Record<string, string> = {};
  for (const r of (reqs as { id: string; org_id: string }[]).reverse()) orgToReqId[r.org_id] = r.id;

  const { data: linked } = await db
    .from("candidate_organizations").select("org_id")
    .eq("candidate_user_id", userId).in("status", ["approved", "pending"]);
  const linkedIds = new Set(((linked ?? []) as { org_id: string }[]).map((l) => l.org_id));

  const { data: existing } = await db
    .from("suggested_matches").select("org_id").eq("candidate_user_id", userId);
  const suggestedIds = new Set(((existing ?? []) as { org_id: string }[]).map((s) => s.org_id));

  const toInsert = Object.entries(orgToReqId)
    .filter(([orgId]) => !linkedIds.has(orgId) && !suggestedIds.has(orgId))
    .map(([orgId, reqId]) => ({ candidate_user_id: userId, org_id: orgId, requirement_id: reqId, status: "pending" }));

  if (toInsert.length > 0) await db.from("suggested_matches").insert(toInsert);
}
