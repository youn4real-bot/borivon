/**
 * AI status-writes with a confirm-first state machine.
 *
 * The assistant NEVER mutates a candidate directly. A write tool STAGES the
 * change (assistant_pending_actions); only after the admin confirms in a
 * separate message does executeLatestPending() apply it. The actual write
 * MIRRORS app/api/portal/pipeline PATCH exactly (candidate_pipeline, status enum
 * pending|passed|failed, ""→null dates, update-then-insert, updated_at stamp) so
 * the AI path can never bypass the portal's validation. Supreme-admin only.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { canActOnCandidate } from "@/lib/admin-auth";
import { isB2Stage } from "@/lib/b2Journey";
import { isAnerkennungStage } from "@/lib/anerkennungJourney";
import { isNurseSpecialty } from "@/lib/nurseSpecialties";
import { allowedOwnersFor, isJourneyOwner } from "@/lib/candidateJourney";
import { cleanPublicText } from "@/lib/sanitizeInput";
import { sendCandidateMessageEmail } from "@/lib/email";
import { FILE_KEY_LABELS } from "@/lib/fileKeys";
import { applyDocReview, applyCandidateProfilePatch } from "@/lib/adminCandidateActions";
import { backfillPassportFromCvDraft } from "@/lib/cvDraftBackfill";
import { sendOutboundEmail, type OutboundAttachment } from "@/lib/outboundEmail";
import { CV_DE_FILE_TYPES } from "@/lib/constants";
import { r2GetObject } from "@/lib/r2";
import { UUID_RE } from "@/lib/uuid";
import { serverBroadcast, ASSIGNMENTS_TOPIC } from "@/lib/serverBroadcast";
import type { AssistantScope } from "@/lib/assistantScope";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/pdf": "pdf", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

type WriteResult = { ok: true } | { ok: false; error: string };

const VALID_INTERVIEW_STATUS = new Set(["pending", "passed", "failed"]);
// Pipeline milestones the AI may set — the full non-supreme allowlist that the
// pipeline PATCH route accepts (ALLOWED_PIPELINE_FIELDS), MINUS the LAW #31
// stage-unlock gates (recognition_unlocked / embassy_unlocked /
// integration_unlocked / start_unlocked). Those four are deliberately ABSENT
// from every set here, so writeMilestone returns bad_field for them — stage
// lock/unlock stays the supreme admin's manual web-only decision (founder
// confirmed: keep it off the bot).
export const MILESTONE_BOOL = new Set([
  "visa_granted", "housing_done", "contract_done", "recognition_done", "docs_approved", "docs_ready", "vorab_done", "arrived_done",
  "interview1_held", "interview2_held",
  "interview1_date_confirmed", "interview2_date_confirmed",
  "interview1_result_date_confirmed", "interview2_result_date_confirmed",
  "visa_appt_date_confirmed", "flight_date_confirmed",
]);
const MILESTONE_DATE = new Set(["visa_date", "visa_appt_date", "flight_date", "interview1_result_date", "interview2_result_date"]);
const MILESTONE_TEXT = new Set(["flight_info", "interview_link", "interview_type", "interview_notes"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const JOURNEY_MAX_TEXT = 500;

/** Update-then-insert a candidate_pipeline patch — mirrors the pipeline PATCH route. */
async function applyPipelinePatch(userId: string, fields: Record<string, unknown>): Promise<WriteResult> {
  if (Object.keys(fields).length === 0) return { ok: false, error: "nothing_to_write" };
  fields.updated_at = new Date().toISOString();
  const db = getServiceSupabase();
  const { data: updated, error: updErr } = await db
    .from("candidate_pipeline").update(fields).eq("user_id", userId).select("user_id");
  if (updErr) return { ok: false, error: "write_failed" };
  if (!updated || updated.length === 0) {
    const { error: insErr } = await db.from("candidate_pipeline").insert({ user_id: userId, ...fields });
    if (insErr) return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

async function writeInterview(userId: string, which: 1 | 2, status: string | undefined, dateISO: string | undefined): Promise<WriteResult> {
  const fields: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!VALID_INTERVIEW_STATUS.has(status)) return { ok: false, error: "bad_status" };
    fields[`interview${which}_status`] = status;
  }
  if (dateISO !== undefined) fields[`interview${which}_date`] = dateISO === "" ? null : dateISO;
  return applyPipelinePatch(userId, fields);
}

/** A curated pipeline milestone (boolean / date / text). */
async function writeMilestone(userId: string, field: string, value: unknown): Promise<WriteResult> {
  let v: unknown;
  if (MILESTONE_BOOL.has(field)) {
    v = value === true || value === "true";
  } else if (MILESTONE_DATE.has(field)) {
    const s = value == null ? "" : String(value);
    if (s !== "" && !ISO_DATE.test(s)) return { ok: false, error: "bad_date" };
    v = s === "" ? null : s;
  } else if (MILESTONE_TEXT.has(field)) {
    v = String(value ?? "").slice(0, 200);
  } else {
    return { ok: false, error: "bad_field" };
  }
  return applyPipelinePatch(userId, { [field]: v });
}

/** B2 status write — mirrors POST /api/portal/journey/b2 (candidate_profiles). */
async function writeB2(userId: string, opts: { stage?: string; failed?: boolean; examDate?: string }): Promise<WriteResult> {
  const patch: Record<string, unknown> = {};
  if (opts.stage !== undefined) {
    if (!isB2Stage(opts.stage)) return { ok: false, error: "bad_stage" };
    patch.b2_stage = opts.stage;
  }
  if (typeof opts.failed === "boolean") patch.b2_failed = opts.failed;
  if (opts.examDate !== undefined) {
    if (opts.examDate !== "" && !ISO_DATE.test(opts.examDate)) return { ok: false, error: "bad_date" };
    patch.b2_exam_date = opts.examDate === "" ? null : opts.examDate;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_write" };
  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update(patch).eq("user_id", userId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Set the Anerkennung (recognition) stage — mirrors POST /api/portal/journey/anerkennung. */
async function writeAnerkennung(userId: string, stage: string): Promise<WriteResult> {
  if (!isAnerkennungStage(stage)) return { ok: false, error: "bad_stage" };
  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update({ anerkennung_stage: stage }).eq("user_id", userId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Set nurse profile facts — mirrors POST /api/portal/journey/profile. Only the
 *  provided fields are written; null/"" clears a field. */
async function writeNurseProfile(
  userId: string,
  opts: { specialty?: string | null; yearsExperience?: string | null; workplace?: string | null; availableFrom?: string | null },
): Promise<WriteResult> {
  const patch: Record<string, unknown> = {};
  if (opts.specialty !== undefined) {
    const s = opts.specialty;
    if (s === null || s === "") patch.nursing_specialty = null;
    else if (isNurseSpecialty(s)) patch.nursing_specialty = s;
    else return { ok: false, error: "bad_specialty" };
  }
  if (opts.yearsExperience !== undefined) {
    const y = opts.yearsExperience;
    if (y === null || y === "") patch.years_experience = null;
    else {
      const n = Math.floor(Number(y));
      if (!Number.isFinite(n) || n < 0 || n > 60) return { ok: false, error: "bad_years" };
      patch.years_experience = n;
    }
  }
  if (opts.workplace !== undefined) patch.current_workplace = cleanPublicText(opts.workplace ?? "", 120) || null;
  if (opts.availableFrom !== undefined) {
    const d = opts.availableFrom;
    if (d === null || d === "") patch.available_from = null;
    else if (ISO_DATE.test(d)) patch.available_from = d;
    else return { ok: false, error: "bad_date" };
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_write" };
  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update(patch).eq("user_id", userId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Drop / refresh a follow-up nudge in the candidate's bell — mirrors POST
 *  /api/portal/journey/nudge (de-duped, masked as "Borivon", never the admin). */
async function writeFollowUpNudge(userId: string, message: string | undefined): Promise<WriteResult> {
  const msg = cleanPublicText(message ?? "", 200) || null;
  const db = getServiceSupabase();
  const { data: existing } = await db
    .from("notifications").select("id")
    .eq("user_id", userId).eq("action", "follow_up").eq("read", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if ((existing as { id?: string } | null)?.id) {
    const { error } = await db.from("notifications")
      .update({ feedback: msg, created_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  const { error } = await db.from("notifications").insert({
    user_id: userId, doc_id: null, doc_name: "Borivon", doc_type: "follow_up", action: "follow_up", feedback: msg, read: false,
  });
  if (error) {
    if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "notifications_not_set_up" };
    return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

/** Manage a candidate's JOURNEY checklist — mirrors /api/portal/journey for the
 *  'borivon' (supreme) party: add/toggle/rename/delete/setDue/setBlocked. Preset
 *  milestones can be toggled/dated/blocked but never renamed or deleted. */
async function writeJourneyItem(
  adminEmail: string,
  candidateUserId: string,
  op: string,
  opts: { id?: string; text?: string; owner?: string; done?: boolean; dueDate?: string | null; blocked?: boolean; reason?: string },
): Promise<WriteResult> {
  const db = getServiceSupabase();

  if (op === "add") {
    const text = (opts.text ?? "").trim().slice(0, JOURNEY_MAX_TEXT);
    if (!text) return { ok: false, error: "text_required" };
    const owner = opts.owner ?? "candidate";
    if (!isJourneyOwner(owner) || !allowedOwnersFor("borivon").includes(owner)) return { ok: false, error: "bad_owner" };
    const { data: maxRow } = await db
      .from("candidate_journey_items").select("position")
      .eq("candidate_user_id", candidateUserId).order("position", { ascending: false }).limit(1).maybeSingle();
    const nextPos = (((maxRow as { position: number } | null)?.position ?? -1) + 1);
    const { error } = await db.from("candidate_journey_items").insert({
      candidate_user_id: candidateUserId, text, owner, preset_key: null, position: nextPos, created_by: adminEmail,
    });
    if (error) {
      if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "journey_not_set_up" };
      return { ok: false, error: "write_failed" };
    }
    return { ok: true };
  }

  // Every other op targets an existing row.
  const id = opts.id ?? "";
  if (!id) return { ok: false, error: "id_required" };
  const { data: rowData } = await db
    .from("candidate_journey_items").select("id, preset_key")
    .eq("id", id).eq("candidate_user_id", candidateUserId).maybeSingle();
  const row = rowData as { id: string; preset_key: string | null } | null;
  if (!row) return { ok: false, error: "not_found" };

  if (op === "delete") {
    if (row.preset_key) return { ok: false, error: "preset_not_deletable" };
    const { error } = await db.from("candidate_journey_items")
      .delete().eq("id", id).eq("candidate_user_id", candidateUserId).is("preset_key", null);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (op === "toggle") {
    const done = opts.done !== false; // default a bare toggle to "done"
    patch.done = done;
    patch.done_by = done ? adminEmail : null;
    patch.done_at = done ? new Date().toISOString() : null;
  } else if (op === "rename") {
    if (row.preset_key) return { ok: false, error: "preset_not_renamable" };
    const txt = (opts.text ?? "").trim().slice(0, JOURNEY_MAX_TEXT);
    if (!txt) return { ok: false, error: "text_required" };
    patch.text = txt;
  } else if (op === "setDue") {
    const d = opts.dueDate;
    if (d === null || d === undefined || d === "") patch.due_date = null;
    else if (ISO_DATE.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`))) patch.due_date = d;
    else return { ok: false, error: "bad_date" };
  } else if (op === "setBlocked") {
    patch.blocked = opts.blocked === true;
    if (opts.blocked === true) {
      if (opts.reason !== undefined) patch.blocked_reason = (opts.reason ?? "").trim().slice(0, JOURNEY_MAX_TEXT) || null;
    } else {
      patch.blocked_reason = null;
    }
  } else {
    return { ok: false, error: "bad_op" };
  }
  const { error } = await db.from("candidate_journey_items")
    .update(patch).eq("id", id).eq("candidate_user_id", candidateUserId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Post an admin → candidate message into the candidate's portal chat (mirrors
 *  POST /api/portal/admin/messages) and/or email it. channel: "chat" (in-app
 *  only), "email" (Resend only), or "both". */
async function writeCandidateMessage(
  adminUserId: string,
  candidateUserId: string,
  text: string,
  channel: "chat" | "email" | "both",
): Promise<WriteResult> {
  const body = text.trim().slice(0, 5000);
  if (!body) return { ok: false, error: "empty" };
  const db = getServiceSupabase();
  let didSomething = false;

  if (channel === "chat" || channel === "both") {
    const { error } = await db.from("messages").insert({
      thread_user_id: candidateUserId,
      sender_user_id: adminUserId,
      sender_role: "admin",
      body,
      kind: "message",
      read_by_admin: true,
      read_by_candidate: false,
    });
    if (error) {
      if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "messages_not_set_up" };
      return { ok: false, error: "write_failed" };
    }
    didSomething = true;
  }

  if (channel === "email" || channel === "both") {
    const { data: u } = await db.auth.admin.getUserById(candidateUserId);
    const email = u?.user?.email ?? null;
    if (!email) {
      if (channel === "email") return { ok: false, error: "no_email" };
    } else {
      const { data: prof } = await db.from("candidate_profiles").select("first_name").eq("user_id", candidateUserId).maybeSingle();
      const firstName = (prof as { first_name?: string | null } | null)?.first_name ?? "";
      const sent = await sendCandidateMessageEmail(email, firstName, body);
      if (sent) didSomething = true;
      else if (channel === "email") return { ok: false, error: "email_not_configured" };
    }
  }

  return didSomething ? { ok: true } : { ok: false, error: "nothing_sent" };
}

/** Create a LEAD / prospective-candidate record (mirrors POST /api/leads). Not
 *  tied to an existing candidate; surfaces in the admin Leads page. */
async function writeLead(opts: { name: string; email?: string; phone?: string; note?: string; cohort?: string }): Promise<WriteResult> {
  const name = opts.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "name_required" };
  const details: Record<string, string> = {};
  if (opts.cohort && opts.cohort.trim()) details.cohort = opts.cohort.trim().slice(0, 60);
  const db = getServiceSupabase();
  const { error } = await db.from("leads").insert({
    kind: "person",
    email: (opts.email ?? "").trim().toLowerCase().slice(0, 254),
    name,
    phone: (opts.phone ?? "").trim().slice(0, 40),
    message: (opts.note ?? "").trim().slice(0, 1000),
    details,
  });
  if (error) {
    if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "leads_not_set_up" };
    return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

/** Store a Telegram-attached file as a candidate document — mirrors an admin
 *  upload (R2-backed row, uploaded_by_admin, status 'pending' for review). The
 *  bytes are ALREADY in R2 (the webhook staged them); we only create the row.
 *  Passport (docKey 'id') bytes are stored AS-IS — never mutated (LAW #39). */
async function writeStoreDocument(opts: { candidateUserId: string; docKey: string; r2Key: string; mime: string; fileName: string; sha256: string }): Promise<WriteResult> {
  if (!opts.r2Key) return { ok: false, error: "no_file" };
  const db = getServiceSupabase();
  const { data: prof } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", opts.candidateUserId).maybeSingle();
  const first = ((prof as { first_name?: string | null } | null)?.first_name ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
  const last = ((prof as { last_name?: string | null } | null)?.last_name ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
  const ext = MIME_EXT[opts.mime.toLowerCase()] ?? ((opts.fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin");
  // file_type stores a translated LABEL (FILE_KEY_LABELS guarantees it maps back
  // to docKey via resolveFileKey), so the dashboard files it in the right box.
  const fileType = FILE_KEY_LABELS[opts.docKey]?.[0] ?? "Sonstiges";
  const structuredName = `${first}_${last}_pflegekraft_${opts.docKey}.${ext}`;
  const baseRow = {
    user_id: opts.candidateUserId,
    file_name: structuredName,
    file_path: `r2/${opts.candidateUserId}/${Date.now()}`,
    file_type: fileType,
    r2_key: opts.r2Key,
    uploaded_by_admin: true,
    status: "pending",
  };
  const { error } = await db.from("documents").insert({ ...baseRow, file_sha256: opts.sha256 });
  if (error) {
    const msg = (error as { message?: string })?.message ?? "";
    // Schema-tolerant: if file_sha256 isn't migrated, retry WITHOUT it but KEEP
    // r2_key (the store of record) — never drop the key (incident 2026-06-09).
    if (/file_sha256|column .* does not exist|schema cache/i.test(msg)) {
      const { error: retryErr } = await db.from("documents").insert(baseRow);
      if (retryErr) return { ok: false, error: "write_failed" };
      return { ok: true };
    }
    if ((error as { code?: string }).code === "PGRST205") return { ok: false, error: "documents_not_set_up" };
    return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

/** Approve/reject/re-pend a document — delegates to the SHARED core that the web
 *  panel uses (notifications, emails, passport gates, verified). LAW #20. */
async function writeReviewDocument(scope: AssistantScope, docId: string, status: string, feedback: string | null): Promise<WriteResult> {
  const db = getServiceSupabase();
  return applyDocReview(db, { docId, status, feedback }, (ownerId) => canActOnCandidate(scope.role, scope.email, ownerId));
}

/** Patch a candidate's passport/profile fields — delegates to the SHARED core
 *  (allowlist + date normalize + OCR wipe + cv_draft propagation LAW #37 + name
 *  sync + notifications + verified). Used by editCandidateProfileField AND
 *  setPassportDataStatus. Caller (the tool) already ran canActOnCandidate. */
async function writeCandidateProfile(userId: string, profile: Record<string, unknown>): Promise<WriteResult> {
  const db = getServiceSupabase();
  return applyCandidateProfilePatch(db, { userId, profile });
}

/** Persist an additive rotation on a document — mirrors PATCH /api/portal/documents/[id]
 *  (additive mod 360). Passport rotation is metadata-only — bytes untouched (LAW #39). */
async function writeRotateDocument(scope: AssistantScope, docId: string, delta: number): Promise<WriteResult> {
  if (!Number.isFinite(delta) || delta % 90 !== 0) return { ok: false, error: "bad_rotation" };
  const db = getServiceSupabase();
  const { data: doc } = await db.from("documents").select("user_id, rotation").eq("id", docId).maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  const ownerId = (doc as { user_id: string }).user_id;
  if (!(await canActOnCandidate(scope.role, scope.email, ownerId))) return { ok: false, error: "out_of_scope" };
  const next = ((((doc as { rotation: number | null }).rotation ?? 0) + delta) % 360 + 360) % 360;
  const { error } = await db.from("documents").update({ rotation: next }).eq("id", docId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Edit ONE CV-only scalar field on a candidate's cv_draft (mirrors the cv-draft
 *  PUT: upsert the whole blob + reverse-propagate). CV-presentation fields only;
 *  identity/passport fields go through writeCandidateProfile (source of truth). */
const CV_SCALAR_FIELDS = new Set(["driverLicense", "hobbies", "email", "phone"]);
async function writeEditCvDraft(userId: string, field: string, value: string): Promise<WriteResult> {
  if (!CV_SCALAR_FIELDS.has(field)) return { ok: false, error: "bad_field" };
  const db = getServiceSupabase();
  const { data } = await db.from("candidate_profiles").select("cv_draft").eq("user_id", userId).maybeSingle();
  const draftRaw = (data as { cv_draft?: unknown } | null)?.cv_draft;
  let draft: Record<string, unknown> | null = null;
  if (draftRaw && typeof draftRaw === "object") draft = { ...(draftRaw as Record<string, unknown>) };
  else if (typeof draftRaw === "string") { try { const p = JSON.parse(draftRaw); if (p && typeof p === "object") draft = p as Record<string, unknown>; } catch { /* malformed */ } }
  if (!draft) return { ok: false, error: "no_cv_yet" }; // never create a partial/malformed draft
  draft[field] = value;
  const { error } = await db.from("candidate_profiles").upsert({ user_id: userId, cv_draft: draft }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "write_failed" };
  try { await backfillPassportFromCvDraft(db, userId, draft); } catch { /* non-fatal */ }
  return { ok: true };
}

/** Send an outbound email to an external recipient, attaching candidate CVs /
 *  documents pulled from R2. Sends as the founder (Gmail App Password → Sent
 *  folder) with a Resend fallback. Out-of-scope candidates are silently skipped
 *  (the tool already gate-checked at stage time). */
async function writeExternalEmail(
  scope: AssistantScope,
  opts: { to: string; toName?: string; subject: string; body: string; candidateIds: string[]; docIds: string[] },
): Promise<WriteResult> {
  const db = getServiceSupabase();
  const attachments: OutboundAttachment[] = [];
  // Track every requested attachment that we COULDN'T resolve to bytes, so we
  // never send an external email whose attachments are fewer than the admin
  // confirmed (silent CV drop = the employer gets an empty package + we'd report
  // success). Any shortfall → refuse and tell the admin which ones are missing.
  const missing: string[] = [];

  // Each candidate's latest German CV on file (with an R2 key).
  for (const cid of opts.candidateIds) {
    if (!(await canActOnCandidate(scope.role, scope.email, cid))) { missing.push(cid); continue; }
    const { data } = await db
      .from("documents")
      .select("file_name, r2_key")
      .eq("user_id", cid)
      .in("file_type", CV_DE_FILE_TYPES as unknown as string[])
      .not("r2_key", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    const doc = ((data ?? [])[0] ?? null) as { file_name: string | null; r2_key: string | null } | null;
    const obj = doc?.r2_key ? await r2GetObject(doc.r2_key) : null;
    if (obj?.body) attachments.push({ filename: doc!.file_name || `cv_${cid}.pdf`, content: obj.body });
    else missing.push(cid);
  }

  // Explicit documents by id.
  for (const did of opts.docIds) {
    const { data: doc } = await db.from("documents").select("user_id, file_name, r2_key").eq("id", did).maybeSingle();
    const d = doc as { user_id: string; file_name: string | null; r2_key: string | null } | null;
    if (!d?.r2_key || !(await canActOnCandidate(scope.role, scope.email, d.user_id))) { missing.push(did); continue; }
    const obj = await r2GetObject(d.r2_key);
    if (obj?.body) attachments.push({ filename: d.file_name || "document.pdf", content: obj.body });
    else missing.push(did);
  }

  // A requested attachment couldn't be produced (e.g. the candidate has no
  // published CV on file yet) — DON'T send a partial email claiming success.
  if (missing.length) return { ok: false, error: `attachment_missing:${missing.slice(0, 8).join(",")}` };

  const res = await sendOutboundEmail({ to: opts.to, toName: opts.toName, subject: opts.subject, body: opts.body, attachments });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/** Assign (or clear) a candidate's employer — mirrors POST /api/portal/admin/assign-employer
 *  (validate employer exists+active unless clearing; upsert candidate_profiles.employer_id).
 *  Drives the visa-letter recipient + agency CV branding. */
async function writeAssignEmployer(userId: string, employerId: string | null): Promise<WriteResult> {
  const db = getServiceSupabase();
  if (employerId) {
    const { data: emp } = await db.from("employers").select("id, active").eq("id", employerId).maybeSingle();
    if (!emp || (emp as { active?: boolean }).active === false) return { ok: false, error: "unknown_or_inactive_employer" };
  }
  const { error } = await db.from("candidate_profiles").upsert({ user_id: userId, employer_id: employerId }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Create or update an employer (hospital/clinic) — mirrors POST/PATCH
 *  /api/portal/admin/employers (same validation: name + address_lines required
 *  on create, slug pattern, agency_id uuid|null, active bool, notes ≤2000; no
 *  hard delete — active=false retires). `address` is split into address_lines. */
async function writeUpsertEmployer(opts: { id?: string; name?: string; address?: string; slug?: string; agencyId?: string | null; active?: boolean; notes?: string }): Promise<WriteResult> {
  const db = getServiceSupabase();
  const isCreate = !opts.id;
  const row: Record<string, unknown> = {};
  if (opts.name !== undefined) {
    const n = opts.name.trim();
    if (!n) return { ok: false, error: "name_required" };
    row.name = n.slice(0, 200);
  } else if (isCreate) return { ok: false, error: "name_required" };
  if (opts.address !== undefined) {
    const lines = opts.address.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
    if (lines.length === 0) return { ok: false, error: "address_required" };
    row.address_lines = lines;
  } else if (isCreate) return { ok: false, error: "address_required" };
  if (opts.slug !== undefined) {
    if (opts.slug === "") row.slug = null;
    else { const s = opts.slug.trim().toLowerCase(); if (!/^[a-z0-9_-]{1,64}$/.test(s)) return { ok: false, error: "bad_slug" }; row.slug = s; }
  }
  if (opts.agencyId !== undefined) {
    if (opts.agencyId === null || opts.agencyId === "") row.agency_id = null;
    else { const a = opts.agencyId.trim(); if (!UUID_RE.test(a)) return { ok: false, error: "bad_agency_id" }; row.agency_id = a; }
  }
  if (opts.active !== undefined) row.active = opts.active === true;
  if (opts.notes !== undefined) row.notes = opts.notes ? opts.notes.slice(0, 2000) : null;
  if (isCreate && !("active" in row)) row.active = true;
  if (!isCreate && Object.keys(row).length === 0) return { ok: false, error: "nothing_to_update" };
  const q = isCreate ? db.from("employers").insert(row) : db.from("employers").update(row).eq("id", opts.id);
  const { error } = await q;
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Link / unlink a candidate to an organization — mirrors POST/DELETE
 *  /api/portal/admin/organizations/[id]/candidates (upsert candidate_organizations
 *  with added_by 'admin' + approved stamp, or delete; then broadcast ASSIGNMENTS
 *  so org-admin bells update. Silent placement — no candidate notification). */
async function writeLinkCandidateToOrg(scope: AssistantScope, candidateUserId: string, orgId: string, op: string, status?: string): Promise<WriteResult> {
  const db = getServiceSupabase();
  if (op === "unlink") {
    const { error } = await db.from("candidate_organizations").delete().eq("org_id", orgId).eq("candidate_user_id", candidateUserId);
    if (error) return { ok: false, error: "write_failed" };
  } else if (op === "link") {
    const st = status === "pending" ? "pending" : "approved";
    const { error } = await db.from("candidate_organizations").upsert({
      candidate_user_id: candidateUserId,
      org_id: orgId,
      status: st,
      added_by: "admin",
      approved_at: st === "approved" ? new Date().toISOString() : null,
      approved_by: st === "approved" ? scope.email : null,
    }, { onConflict: "candidate_user_id,org_id" });
    if (error) return { ok: false, error: "write_failed" };
  } else {
    return { ok: false, error: "bad_op" };
  }
  try { await serverBroadcast(ASSIGNMENTS_TOPIC, "changed"); } catch { /* non-fatal */ }
  return { ok: true };
}

/** Nudge every stuck candidate (the auto-chase list) — reuses writeFollowUpNudge
 *  per candidate, scope-gated. Returns ok if at least one nudge landed. */
async function writeNudgeStuck(scope: AssistantScope, candidateIds: string[], message: string | undefined): Promise<WriteResult> {
  if (candidateIds.length === 0) return { ok: false, error: "none" };
  let n = 0;
  for (const id of candidateIds) {
    if (!(await canActOnCandidate(scope.role, scope.email, id))) continue;
    const r = await writeFollowUpNudge(id, message);
    if (r.ok) n++;
  }
  return n > 0 ? { ok: true } : { ok: false, error: "write_failed" };
}

/** The admin's agency/employer contact profile fields (form section C). */
export const AGENCY_PROFILE_FIELDS = ["firma", "strasse", "hausnummer", "plz", "ort", "kontaktperson", "telefon", "email", "telefax", "betriebsnummer"] as const;

/** Upsert the calling admin's agency profile — mirrors PATCH /api/portal/admin/agency-profile. */
async function writeAgencyProfile(userId: string, fields: Record<string, string>): Promise<WriteResult> {
  const update: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  let n = 0;
  for (const k of AGENCY_PROFILE_FIELDS) {
    if (k in fields) { update[k] = fields[k] ? String(fields[k]).trim() : null; n++; }
  }
  if (n === 0) return { ok: false, error: "nothing_to_write" };
  const db = getServiceSupabase();
  const { error } = await db.from("agency_profiles").upsert(update, { onConflict: "user_id" });
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

type PendingRow = {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  candidate_user_id: string | null;
  summary: string;
  expires_at: string;
};

async function getLatestPending(ownerId: string): Promise<PendingRow | null> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("assistant_pending_actions")
    .select("id, tool_name, args, candidate_user_id, summary, expires_at")
    .eq("owner_user_id", ownerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as PendingRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null; // expired
  return row;
}

/** Stage a proposed write for confirmation. Returns the summary to show the admin. */
export async function stagePending(
  scope: AssistantScope,
  opts: { toolName: string; args: Record<string, unknown>; candidateUserId: string | null; summary: string },
): Promise<{ staged: true; summary: string } | { error: string }> {
  if (!scope.userId) return { error: "no_user" };
  const db = getServiceSupabase();
  // Drop any older still-pending proposal for this admin so 'yes' is unambiguous.
  await db.from("assistant_pending_actions").update({ status: "cancelled" })
    .eq("owner_user_id", scope.userId).eq("status", "pending");
  const { error } = await db.from("assistant_pending_actions").insert({
    owner_user_id: scope.userId,
    tool_name: opts.toolName,
    // __stagedReq stamps the request that staged this action (stored inside the
    // existing args jsonb — no schema change). executeLatestPending refuses to
    // run it within that SAME request, so a write can never be staged AND
    // confirmed in one model turn (anti prompt-injection — see AssistantScope).
    args: { ...opts.args, __stagedReq: scope.requestId ?? null },
    candidate_user_id: opts.candidateUserId || null, // null for non-candidate actions (e.g. createLead)
    summary: opts.summary,
    status: "pending",
  });
  if (error) return { error: "stage_failed" };
  return { staged: true, summary: opts.summary };
}

/** Apply the most recent staged write AFTER the admin confirms. */
export async function executeLatestPending(
  scope: AssistantScope,
): Promise<{ done: true; summary: string } | { error: string }> {
  const row = await getLatestPending(scope.userId);
  if (!row) return { error: "nothing_pending" };
  // Anti-injection: a write may NOT be confirmed in the same request that staged
  // it. The model loops up to ~8 tool calls per inbound message, so without this
  // it could stage AND call confirmPendingWrite in one turn — skipping the human
  // checkpoint (e.g. driven by an instruction injected into a candidate's data).
  // Confirmation must come from a LATER admin message (a fresh requestId).
  const stagedReq = (row.args as Record<string, unknown> | null)?.__stagedReq;
  if (stagedReq && scope.requestId && stagedReq === scope.requestId) {
    return { error: "confirm_in_new_message" };
  }
  // Serve-time scope re-check (defense-in-depth).
  if (row.candidate_user_id && !(await canActOnCandidate(scope.role, scope.email, row.candidate_user_id))) {
    const db = getServiceSupabase();
    await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", row.id);
    return { error: "out_of_scope" };
  }
  const a = row.args;
  let result: { ok: true } | { ok: false; error: string } = { ok: false, error: "unknown_tool" };
  if (row.tool_name === "setInterviewResult") {
    result = await writeInterview(String(a.candidateUserId), Number(a.which) === 2 ? 2 : 1, String(a.result), undefined);
  } else if (row.tool_name === "setInterviewDate") {
    result = await writeInterview(String(a.candidateUserId), Number(a.which) === 2 ? 2 : 1, undefined, a.date == null ? "" : String(a.date));
  } else if (row.tool_name === "setCandidateMilestone") {
    result = await writeMilestone(String(a.candidateUserId), String(a.field), a.value);
  } else if (row.tool_name === "setB2Status") {
    result = await writeB2(String(a.candidateUserId), {
      stage: a.stage == null ? undefined : String(a.stage),
      failed: typeof a.failed === "boolean" ? a.failed : undefined,
      examDate: a.examDate == null ? undefined : String(a.examDate),
    });
  } else if (row.tool_name === "sendCandidateMessage") {
    const ch = a.channel === "email" ? "email" : a.channel === "both" ? "both" : "chat";
    result = await writeCandidateMessage(scope.userId, String(a.candidateUserId), String(a.text ?? ""), ch);
  } else if (row.tool_name === "createLead") {
    result = await writeLead({
      name: String(a.name ?? ""),
      email: a.email == null ? undefined : String(a.email),
      phone: a.phone == null ? undefined : String(a.phone),
      note: a.note == null ? undefined : String(a.note),
      cohort: a.cohort == null ? undefined : String(a.cohort),
    });
  } else if (row.tool_name === "storeCandidateDocument") {
    result = await writeStoreDocument({
      candidateUserId: String(a.candidateUserId),
      docKey: String(a.docKey ?? "other"),
      r2Key: String(a.r2Key ?? ""),
      mime: String(a.mime ?? "application/octet-stream"),
      fileName: String(a.fileName ?? "document"),
      sha256: String(a.sha256 ?? ""),
    });
  } else if (row.tool_name === "setAnerkennungStage") {
    result = await writeAnerkennung(String(a.candidateUserId), String(a.stage ?? ""));
  } else if (row.tool_name === "setNurseProfile") {
    result = await writeNurseProfile(String(a.candidateUserId), {
      specialty: a.specialty === undefined ? undefined : a.specialty == null ? null : String(a.specialty),
      yearsExperience: a.yearsExperience === undefined ? undefined : a.yearsExperience == null ? null : String(a.yearsExperience),
      workplace: a.workplace === undefined ? undefined : a.workplace == null ? null : String(a.workplace),
      availableFrom: a.availableFrom === undefined ? undefined : a.availableFrom == null ? null : String(a.availableFrom),
    });
  } else if (row.tool_name === "sendFollowUpNudge") {
    result = await writeFollowUpNudge(String(a.candidateUserId), a.message == null ? undefined : String(a.message));
  } else if (row.tool_name === "manageJourneyItem") {
    result = await writeJourneyItem(scope.email, String(a.candidateUserId), String(a.op ?? ""), {
      id: a.id == null ? undefined : String(a.id),
      text: a.text == null ? undefined : String(a.text),
      owner: a.owner == null ? undefined : String(a.owner),
      done: typeof a.done === "boolean" ? a.done : undefined,
      dueDate: a.dueDate === undefined ? undefined : a.dueDate == null ? null : String(a.dueDate),
      blocked: typeof a.blocked === "boolean" ? a.blocked : undefined,
      reason: a.reason == null ? undefined : String(a.reason),
    });
  } else if (row.tool_name === "reviewDocument") {
    result = await writeReviewDocument(scope, String(a.docId), String(a.status ?? ""), a.feedback == null ? null : String(a.feedback));
  } else if (row.tool_name === "editCandidateProfileField") {
    result = await writeCandidateProfile(String(a.candidateUserId), { [String(a.field)]: a.value == null ? "" : String(a.value) });
  } else if (row.tool_name === "setPassportDataStatus") {
    const prof: Record<string, unknown> = { passport_status: String(a.status ?? "") };
    if (a.feedback != null) prof.passport_feedback = String(a.feedback);
    result = await writeCandidateProfile(String(a.candidateUserId), prof);
  } else if (row.tool_name === "rotateDocument") {
    result = await writeRotateDocument(scope, String(a.docId), Number(a.deltaRotation));
  } else if (row.tool_name === "editCvDraft") {
    result = await writeEditCvDraft(String(a.candidateUserId), String(a.field), a.value == null ? "" : String(a.value));
  } else if (row.tool_name === "setCvBrandingMode") {
    const mode = String(a.mode ?? "");
    const prof: Record<string, unknown> =
      mode === "agency" ? { cv_use_agency_branding: true, cv_use_borivon_branding: true } :
      mode === "borivon" ? { cv_use_agency_branding: false, cv_use_borivon_branding: true } :
      mode === "none" ? { cv_use_borivon_branding: false } : {};
    result = Object.keys(prof).length ? await writeCandidateProfile(String(a.candidateUserId), prof) : { ok: false, error: "bad_mode" };
  } else if (row.tool_name === "sendExternalEmail") {
    const splitIds = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    result = await writeExternalEmail(scope, {
      to: String(a.to ?? ""),
      toName: a.toName == null ? undefined : String(a.toName),
      subject: String(a.subject ?? ""),
      body: String(a.body ?? ""),
      candidateIds: splitIds(a.attachCandidateIds),
      docIds: splitIds(a.attachDocIds),
    });
  } else if (row.tool_name === "generateAndPublishCv") {
    // Lazy import: @react-pdf/renderer is heavy — only load it when a CV is
    // actually being published, not on every assistant turn.
    const { publishCandidateCv } = await import("@/lib/cvRender");
    result = await publishCandidateCv(String(a.candidateUserId));
  } else if (row.tool_name === "assignEmployer") {
    result = await writeAssignEmployer(String(a.candidateUserId), a.employerId == null || a.employerId === "" ? null : String(a.employerId));
  } else if (row.tool_name === "upsertEmployer") {
    result = await writeUpsertEmployer({
      id: a.id == null ? undefined : String(a.id),
      name: a.name == null ? undefined : String(a.name),
      address: a.address == null ? undefined : String(a.address),
      slug: a.slug == null ? undefined : String(a.slug),
      agencyId: a.agencyId === undefined ? undefined : a.agencyId == null ? null : String(a.agencyId),
      active: typeof a.active === "boolean" ? a.active : undefined,
      notes: a.notes == null ? undefined : String(a.notes),
    });
  } else if (row.tool_name === "linkCandidateToOrg") {
    result = await writeLinkCandidateToOrg(scope, String(a.candidateUserId), String(a.orgId), String(a.op ?? ""), a.status == null ? undefined : String(a.status));
  } else if (row.tool_name === "nudgeStuckCandidates") {
    const ids = Array.isArray(a.candidateIds) ? (a.candidateIds as unknown[]).map((x) => String(x)) : String(a.candidateIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    result = await writeNudgeStuck(scope, ids, a.message == null ? undefined : String(a.message));
  } else if (row.tool_name === "setAgencyProfile") {
    const f: Record<string, string> = {};
    for (const k of AGENCY_PROFILE_FIELDS) { if (a[k] !== undefined) f[k] = a[k] == null ? "" : String(a[k]); }
    result = await writeAgencyProfile(scope.userId, f);
  }
  if (!result.ok) return { error: result.error };
  const db = getServiceSupabase();
  await db.from("assistant_pending_actions").update({ status: "confirmed" }).eq("id", row.id);
  return { done: true, summary: row.summary };
}

/** Discard the most recent staged write. */
export async function cancelLatestPending(
  scope: AssistantScope,
): Promise<{ cancelled: true; summary: string } | { error: string }> {
  const row = await getLatestPending(scope.userId);
  if (!row) return { error: "nothing_pending" };
  const db = getServiceSupabase();
  await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", row.id);
  return { cancelled: true, summary: row.summary };
}
