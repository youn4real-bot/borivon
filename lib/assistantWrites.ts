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
import { canActOnCandidate, ciEmail } from "@/lib/admin-auth";
import { isB2Stage } from "@/lib/b2Journey";
import { isAnerkennungStage } from "@/lib/anerkennungJourney";
import { isNurseSpecialty } from "@/lib/nurseSpecialties";
import { allowedOwnersFor, isJourneyOwner } from "@/lib/candidateJourney";
import { cleanPublicText } from "@/lib/sanitizeInput";
import { sendCandidateMessageEmail, sendVerifiedEmail } from "@/lib/email";
import { FILE_KEY_LABELS } from "@/lib/fileKeys";
import { applyDocReview, applyCandidateProfilePatch } from "@/lib/adminCandidateActions";
import { backfillPassportFromCvDraft } from "@/lib/cvDraftBackfill";
import { sendOutboundEmail, OUTBOUND_FROM_NAME, OUTBOUND_FROM_EMAIL, OUTBOUND_SIGNATURE_HTML, OUTBOUND_SIGNATURE_TEXT, type OutboundAttachment } from "@/lib/outboundEmail";
import { buildInviteIcs } from "@/lib/calendarInvite";
import { gmailGet, gmailSendRaw, listEmailAttachments, getEmailAttachmentBytes } from "@/lib/gmailApi";
import { bookWorkspaceEvent } from "@/lib/workspaceCalendar";
import { reportError } from "@/lib/reportError";
import { stripMarkdown } from "@/lib/emailFormat";
import { resolveFileKey } from "@/lib/fileKeys";
import { r2GetObject } from "@/lib/r2";
import { validateImageDataUrl } from "@/lib/validateDataUrl";
import { isFunnelStage } from "@/lib/batchBoard";
import { UUID_RE } from "@/lib/uuid";
import { serverBroadcast, ASSIGNMENTS_TOPIC } from "@/lib/serverBroadcast";
import { normalizeReq } from "@/lib/impfungJourney";
import type { AssistantScope } from "@/lib/assistantScope";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/pdf": "pdf", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

type WriteResult = { ok: true; info?: string } | { ok: false; error: string };

const VALID_INTERVIEW_STATUS = new Set(["pending", "passed", "failed"]);
// Pipeline milestones the AI may set — the full non-supreme allowlist that the
// pipeline PATCH route accepts (ALLOWED_PIPELINE_FIELDS), MINUS the LAW #31
// stage-unlock gates (recognition_unlocked / embassy_unlocked /
// integration_unlocked / start_unlocked). Those four stay ABSENT here so the
// GENERIC milestone tool can't touch a lock by accident. Stage lock/unlock now
// has its OWN dedicated supreme-only tool (toggleStageLock → writeStageLock),
// per the founder's 2026-06 decision to put every supreme-admin action in the
// bot — the supreme admin operating the lock via the bot IS LAW #31.
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
  opts: { to: string; toName?: string; cc?: string[]; subject: string; body: string; candidateIds: string[]; docIds: string[]; attachFromEmailIds?: string[] },
): Promise<WriteResult> {
  const db = getServiceSupabase();
  const attachments: OutboundAttachment[] = [];
  // Track every requested attachment that we COULDN'T resolve to bytes, so we
  // never send an external email whose attachments are fewer than the admin
  // confirmed (silent CV drop = the employer gets an empty package + we'd report
  // success). Any shortfall → refuse and tell the admin which ones are missing.
  const missing: string[] = [];

  // Attach each candidate's CURRENT CV — rendered FRESH from cv_draft (exactly
  // what's on the website now) so an employer never gets a stale pre-edit PDF.
  // Falls back to the latest stored CV document only if there's no cv_draft.
  const CV_EMAIL_KINDS = new Set(["cv_de", "cv_visa"]);
  for (const cid of opts.candidateIds) {
    if (!(await canActOnCandidate(scope.role, scope.email, cid))) { missing.push(cid); continue; }
    let attached = false;
    try {
      const { renderCandidateCvPdf } = await import("@/lib/cvRender"); // lazy — heavy react-pdf
      const fresh = await renderCandidateCvPdf(cid, { plain: false }); // current German CV, branded
      if (fresh?.bytes?.length) { attachments.push({ filename: fresh.fileName, content: fresh.bytes }); attached = true; }
    } catch (e) {
      console.error("[writeExternalEmail] live CV render failed, falling back to stored:", e instanceof Error ? e.message : e);
    }
    if (attached) continue;
    // Fallback: the latest stored CV document (no cv_draft to render from).
    const { data } = await db
      .from("documents")
      .select("file_name, file_type, r2_key")
      .eq("user_id", cid)
      .not("r2_key", "is", null)
      .order("uploaded_at", { ascending: false });
    const rows = (data ?? []) as { file_name: string | null; file_type: string | null; r2_key: string | null }[];
    const cv = rows.find((d) => resolveFileKey(d.file_type) === "cv_de")
      ?? rows.find((d) => CV_EMAIL_KINDS.has(resolveFileKey(d.file_type)));
    const obj = cv?.r2_key ? await r2GetObject(cv.r2_key) : null;
    if (obj?.body) attachments.push({ filename: cv!.file_name || `cv_${cid}.pdf`, content: obj.body });
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

  // FORWARD attachments pulled from the founder's Gmail (e.g. "send Anna the
  // Defizitbescheid Abdelhak attached"). For each source email, fetch every file
  // attachment natively and enclose it. A message that yields no bytes is a
  // shortfall → refuse (never send claiming files that aren't actually attached).
  for (const mid of opts.attachFromEmailIds ?? []) {
    const atts = await listEmailAttachments(mid);
    if (!atts || atts.length === 0) { missing.push(`email:${mid}`); continue; }
    let got = 0;
    for (const a of atts.slice(0, 20)) {
      const bytes = await getEmailAttachmentBytes(mid, a.attachmentId);
      if (bytes?.length) { attachments.push({ filename: a.filename || "attachment", content: bytes }); got++; }
    }
    if (got === 0) missing.push(`email:${mid}`);
  }

  // A requested attachment couldn't be produced (e.g. the candidate has no
  // published CV on file yet) — DON'T send a partial email claiming success.
  if (missing.length) return { ok: false, error: `attachment_missing:${missing.slice(0, 8).join(",")}` };

  const res = await sendOutboundEmail({ to: opts.to, toName: opts.toName, cc: opts.cc, subject: opts.subject, body: opts.body, attachments });
  if (!res.ok) return { ok: false, error: res.error };
  // Log it so the bot can recall / resend it later ("resend yesterday's email").
  // Best-effort: if the table isn't migrated yet, the send still succeeds.
  try {
    await db.from("assistant_sent_emails").insert({
      owner_user_id: scope.userId,
      to_email: opts.to,
      cc: (opts.cc ?? []).join(",") || null,
      subject: opts.subject,
      body: opts.body,
      candidate_ids: opts.candidateIds.join(",") || null,
      doc_ids: opts.docIds.join(",") || null,
      channel: res.channel,
    });
  } catch { /* assistant_sent_emails not migrated yet → skip the log */ }
  return { ok: true };
}

/** Send a real CALENDAR INVITATION — an .ics (METHOD:REQUEST) emailed to the
 *  attendees so they get Yes/Maybe/No and it lands in their calendar. Organizer
 *  is the founder; rides the existing Gmail App Password (no Google OAuth). */
async function writeCalendarInvite(opts: {
  attendees: string[]; title: string; startsAt: string; endsAt?: string;
  durationMinutes?: number; location?: string; description?: string; method?: "REQUEST" | "CANCEL";
}): Promise<WriteResult> {
  const emails = opts.attendees.map((e) => e.trim()).filter(Boolean);
  const bad = emails.find((e) => !EMAIL_RE.test(e));
  if (bad) return { ok: false, error: `bad_attendee:${bad}` };
  if (emails.length === 0) return { ok: false, error: "no_attendees" };
  if (!opts.title.trim()) return { ok: false, error: "no_title" };

  const start = new Date(opts.startsAt);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "bad_start_time" };
  let end = opts.endsAt ? new Date(opts.endsAt) : null;
  if (end && Number.isNaN(end.getTime())) end = null;
  if (!end) end = new Date(start.getTime() + (opts.durationMinutes && opts.durationMinutes > 0 ? opts.durationMinutes : 60) * 60_000);

  const { ics, method } = buildInviteIcs({
    organizerName: OUTBOUND_FROM_NAME,
    organizerEmail: OUTBOUND_FROM_EMAIL,
    attendees: emails.map((email) => ({ email })),
    title: opts.title.trim(),
    start, end,
    location: opts.location?.trim() || undefined,
    description: opts.description?.trim() || undefined,
    method: opts.method,
  });

  const when = start.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const body = [
    method === "CANCEL" ? `This meeting has been cancelled: ${opts.title}` : `You're invited: ${opts.title}`,
    `When: ${when}`,
    opts.location ? `Where: ${opts.location}` : "",
    opts.description ? `\n${opts.description}` : "",
    method === "CANCEL" ? "" : "\nPlease accept or decline using your calendar.",
  ].filter(Boolean).join("\n");

  const res = await sendOutboundEmail({
    to: emails.join(", "),
    subject: (method === "CANCEL" ? "Cancelled: " : "Invitation: ") + opts.title.trim(),
    body,
    icalEvent: { method, content: ics },
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Reply to an email IN-THREAD via the native Gmail API — reads the original for
 *  its threadId + Message-ID + From/Subject, then sends a properly-threaded reply
 *  (In-Reply-To/References + threadId) from the founder's mailbox. */
async function writeReplyEmail(scope: AssistantScope, opts: { messageId: string; body: string; replyAll?: boolean }): Promise<WriteResult> {
  if (!opts.messageId) return { ok: false, error: "no_message" };
  const orig = await gmailGet(opts.messageId);
  if (!orig) return { ok: false, error: "original_not_found_or_not_connected" };
  const subject = /^re:/i.test(orig.subject.trim()) ? orig.subject : `Re: ${orig.subject}`;
  const self = OUTBOUND_FROM_EMAIL.toLowerCase();
  let cc = "";
  if (opts.replyAll) {
    const extra = [orig.to, orig.cc].join(",").split(",").map((s) => s.trim()).filter(Boolean)
      .filter((a) => { const e = (a.match(/<([^>]+)>/)?.[1] || a).toLowerCase(); return !e.includes(self) && e !== orig.from; });
    cc = [...new Set(extra)].join(", ");
  }
  const references = [orig.references, orig.messageIdHeader].filter(Boolean).join(" ").trim();
  const cleanBody = stripMarkdown(opts.body).trimEnd();
  const text = `${cleanBody}\n\n${OUTBOUND_SIGNATURE_TEXT}`;
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">${escHtml(cleanBody).replace(/\n/g, "<br/>")}</div><br/>${OUTBOUND_SIGNATURE_HTML}`;
  const res = await gmailSendRaw({
    to: orig.from, cc: cc || undefined, subject, html, text,
    fromName: OUTBOUND_FROM_NAME, fromEmail: OUTBOUND_FROM_EMAIL,
    inReplyTo: orig.messageIdHeader || undefined, references: references || undefined, threadId: orig.threadId || undefined,
  });
  if (!res.ok) return { ok: false, error: res.error || "reply_failed" };
  try {
    await getServiceSupabase().from("assistant_sent_emails").insert({
      owner_user_id: scope.userId, to_email: orig.from, cc: cc || null, subject, body: cleanBody, channel: "gmail-api",
    });
  } catch { /* sent-email log not migrated → skip */ }
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
  if (isCreate) {
    const { error } = await db.from("employers").insert(row);
    return error ? { ok: false, error: "write_failed" } : { ok: true };
  }
  // Edit: .select() so a zero-match (bad/invented id) is caught as not_found
  // instead of silently returning ok:true with nothing changed.
  const { data: updated, error } = await db.from("employers").update(row).eq("id", opts.id).select("id");
  if (error) return { ok: false, error: "write_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "employer_not_found" };
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

/** Approve / reject a pending candidate→org link request — mirrors
 *  POST (approve) / DELETE (reject) /api/portal/admin/organization-requests.
 *  Approve stamps approved_at/by; reject writes status='rejected' (audit trail,
 *  never hard-delete); both only touch rows still status='pending'. */
async function writeOrgRequest(scope: AssistantScope, candidateUserId: string, orgId: string, decision: string): Promise<WriteResult> {
  if (!UUID_RE.test(candidateUserId) || !UUID_RE.test(orgId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  if (decision === "approve") {
    const { error } = await db.from("candidate_organizations").update({
      status: "approved", approved_at: new Date().toISOString(), approved_by: scope.email,
    }).eq("candidate_user_id", candidateUserId).eq("org_id", orgId).eq("status", "pending");
    if (error) return { ok: false, error: "write_failed" };
  } else if (decision === "reject") {
    const { error } = await db.from("candidate_organizations").update({ status: "rejected" })
      .eq("candidate_user_id", candidateUserId).eq("org_id", orgId).eq("status", "pending");
    if (error) return { ok: false, error: "write_failed" };
  } else {
    return { ok: false, error: "bad_decision" };
  }
  try { await serverBroadcast(ASSIGNMENTS_TOPIC, "changed"); } catch { /* non-fatal */ }
  return { ok: true };
}

/** Accept / skip a suggested candidate↔org match — mirrors POST
 *  /api/portal/admin/suggested-matches. Marks the match decided; on accept,
 *  upserts an approved candidate_organizations link (silent placement — no
 *  candidate notification, exactly like the website). */
async function writeSuggestedMatch(scope: AssistantScope, matchId: string, action: string): Promise<WriteResult> {
  if (!UUID_RE.test(matchId)) return { ok: false, error: "bad_id" };
  if (action !== "accepted" && action !== "skipped") return { ok: false, error: "bad_action" };
  const db = getServiceSupabase();
  const { data: match } = await db.from("suggested_matches")
    .select("id, candidate_user_id, org_id, status").eq("id", matchId).eq("status", "pending").maybeSingle();
  if (!match) return { ok: false, error: "not_found_or_decided" };
  const m = match as { candidate_user_id: string; org_id: string };
  const { error: decErr } = await db.from("suggested_matches").update({
    status: action, decided_at: new Date().toISOString(), decided_by: scope.email,
  }).eq("id", matchId);
  if (decErr) return { ok: false, error: "write_failed" };
  if (action === "accepted") {
    const { data: existing } = await db.from("candidate_organizations").select("status")
      .eq("candidate_user_id", m.candidate_user_id).eq("org_id", m.org_id).maybeSingle();
    if (existing) {
      await db.from("candidate_organizations").update({
        status: "approved", approved_at: new Date().toISOString(), approved_by: scope.email,
      }).eq("candidate_user_id", m.candidate_user_id).eq("org_id", m.org_id);
    } else {
      await db.from("candidate_organizations").insert({
        candidate_user_id: m.candidate_user_id, org_id: m.org_id, status: "approved",
        added_by: "admin", approved_at: new Date().toISOString(), approved_by: scope.email,
      });
    }
    try { await serverBroadcast(ASSIGNMENTS_TOPIC, "changed"); } catch { /* non-fatal */ }
  }
  return { ok: true };
}

/** Create or rename/edit a partner organization — mirrors POST
 *  /api/portal/admin/organizations (create: name required, mints unique 8-char
 *  invite_code + crypto member_invite_code) and PATCH .../[id] (edit name/notes/
 *  invite_code). No delete — org deletion cascades to candidate links, so it
 *  stays a web-only action. */
async function writeManageOrganization(opts: { op: string; orgId?: string; name?: string; notes?: string; inviteCode?: string }): Promise<WriteResult> {
  const db = getServiceSupabase();
  const cleanCode = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
  if (opts.op === "create") {
    const name = (opts.name ?? "").trim().slice(0, 200);
    if (!name) return { ok: false, error: "name_required" };
    let code = opts.inviteCode ? cleanCode(opts.inviteCode) : "";
    if (code) {
      const { data: clash } = await db.from("organizations").select("id").eq("invite_code", code).maybeSingle();
      if (clash) return { ok: false, error: "code_in_use" };
    } else {
      for (let i = 0; i < 5; i++) {
        const cand = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 30]).join("");
        const { data: clash } = await db.from("organizations").select("id").eq("invite_code", cand).maybeSingle();
        if (!clash) { code = cand; break; }
      }
      if (!code) return { ok: false, error: "code_gen_failed" };
    }
    const memberCode = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const { error } = await db.from("organizations").insert({
      name, notes: (opts.notes ?? "").trim().slice(0, 500) || null, invite_code: code, member_invite_code: memberCode,
    });
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  } else if (opts.op === "edit") {
    if (!opts.orgId || !UUID_RE.test(opts.orgId)) return { ok: false, error: "bad_id" };
    const updates: Record<string, unknown> = {};
    if (opts.name !== undefined) { const n = opts.name.trim().slice(0, 200); if (!n) return { ok: false, error: "name_empty" }; updates.name = n; }
    if (opts.notes !== undefined) updates.notes = opts.notes.trim().slice(0, 500) || null;
    if (opts.inviteCode !== undefined) { const c = cleanCode(opts.inviteCode); if (!c) return { ok: false, error: "code_empty" }; updates.invite_code = c; }
    if (Object.keys(updates).length === 0) return { ok: false, error: "nothing_to_update" };
    const { error } = await db.from("organizations").update(updates).eq("id", opts.orgId);
    if (error) return { ok: false, error: (error as { code?: string }).code === "23505" ? "code_in_use" : "write_failed" };
    return { ok: true };
  }
  return { ok: false, error: "bad_op" };
}

/** Set an org's branding / vaccine requirement — mirrors the branding fields of
 *  PATCH /api/portal/admin/organizations/[id] (footer_text + vaccine_req via
 *  normalizeReq). Logo upload stays web-only (needs a file). */
async function writeOrgBranding(orgId: string, opts: { footerText?: string; masern?: number; varizell?: number }): Promise<WriteResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "bad_id" };
  const updates: Record<string, unknown> = {};
  if (opts.footerText !== undefined) updates.footer_text = opts.footerText.trim().slice(0, 500) || null;
  if (opts.masern !== undefined || opts.varizell !== undefined) {
    updates.vaccine_req = normalizeReq({ masern: opts.masern ?? 0, varizell: opts.varizell ?? 0 });
  }
  if (Object.keys(updates).length === 0) return { ok: false, error: "nothing_to_update" };
  const db = getServiceSupabase();
  // .select() so a bad/invented orgId is caught (zero rows) instead of silently
  // returning ok:true having changed nothing.
  const { data: updated, error } = await db.from("organizations").update(updates).eq("id", orgId).select("id");
  if (error) return { ok: false, error: "write_failed" };
  if (!updated || updated.length === 0) return { ok: false, error: "org_not_found" };
  return { ok: true };
}

/** Add / edit / close an org requirement (open need) — mirrors POST/PATCH/DELETE
 *  /api/portal/admin/organizations/[id]/requirements. Close = active:false
 *  (audit trail, never hard-delete). */
async function writeOrgRequirement(opts: { op: string; orgId?: string; requirementId?: string; specialty?: string; slots?: number; location?: string; startDate?: string; notes?: string }): Promise<WriteResult> {
  const db = getServiceSupabase();
  if (opts.op === "add") {
    if (!opts.orgId || !UUID_RE.test(opts.orgId)) return { ok: false, error: "bad_id" };
    const { error } = await db.from("org_requirements").insert({
      org_id: opts.orgId,
      specialty: opts.specialty ? opts.specialty.trim().slice(0, 200) || null : null,
      slots: typeof opts.slots === "number" ? Math.max(1, Math.floor(opts.slots)) : 1,
      location: opts.location ? opts.location.trim().slice(0, 200) || null : null,
      start_date: opts.startDate ? opts.startDate : null,
      notes: opts.notes ? opts.notes.trim().slice(0, 500) || null : null,
      active: true,
    });
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (!opts.requirementId || !UUID_RE.test(opts.requirementId)) return { ok: false, error: "bad_id" };
  if (opts.op === "close") {
    const { error } = await db.from("org_requirements").update({ active: false }).eq("id", opts.requirementId);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (opts.op === "edit") {
    const updates: Record<string, unknown> = {};
    if (opts.specialty !== undefined) updates.specialty = opts.specialty.trim().slice(0, 200) || null;
    if (typeof opts.slots === "number") updates.slots = Math.max(1, Math.floor(opts.slots));
    if (opts.location !== undefined) updates.location = opts.location.trim().slice(0, 200) || null;
    if (opts.startDate !== undefined) updates.start_date = opts.startDate || null;
    if (opts.notes !== undefined) updates.notes = opts.notes.trim().slice(0, 500) || null;
    if (Object.keys(updates).length === 0) return { ok: false, error: "nothing_to_update" };
    const { error } = await db.from("org_requirements").update(updates).eq("id", opts.requirementId);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  return { ok: false, error: "bad_op" };
}

/** Send a candidate the B/V wizard slot request (turns the slot orange,
 *  "waiting on candidate") — mirrors POST /api/portal/admin/phase-slots/notify:
 *  resolve the label server-side, dedupe an unread sign_request bell for the
 *  same slot, else insert one. doc_type variant drives the deep-link routing. */
async function writeSlotNotify(slotId: string, candidateUserId: string, needsSign: boolean, needsFill: boolean): Promise<WriteResult> {
  if (!UUID_RE.test(slotId) || !UUID_RE.test(candidateUserId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  const { data: slotRow } = await db.from("phase_slots").select("label").eq("id", slotId).maybeSingle();
  const label = ((slotRow as { label?: string | null } | null)?.label ?? "").trim() || "Dokument";
  const docType =
    needsSign && needsFill ? "slot_setup_sign_fill" :
    needsSign ? "slot_setup_sign" :
    needsFill ? "slot_setup_fill" :
    "slot_setup";
  const { data: existing } = await db.from("notifications").select("id")
    .eq("user_id", candidateUserId).eq("doc_id", slotId).eq("action", "sign_request").eq("read", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if ((existing as { id?: string } | null)?.id) {
    const { error } = await db.from("notifications").update({
      doc_name: label, doc_type: docType, created_at: new Date().toISOString(),
    }).eq("id", (existing as { id: string }).id);
    if (error) return { ok: false, error: "write_failed" };
  } else {
    const { error } = await db.from("notifications").insert({
      user_id: candidateUserId, doc_id: slotId, doc_name: label, doc_type: docType,
      action: "sign_request", feedback: null, read: false,
    });
    if (error) return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

/** Accept / reject a candidate-signed sign_request — mirrors PATCH
 *  /api/portal/admin/sign-request/[id]: only a status='signed' request can be
 *  reviewed (LAW #20: reject needs feedback), set review_status, notify the
 *  candidate. */
async function writeSignRequestReview(scope: AssistantScope, signRequestId: string, action: string, feedback: string | null): Promise<WriteResult> {
  if (!UUID_RE.test(signRequestId)) return { ok: false, error: "bad_id" };
  if (action !== "accept" && action !== "reject") return { ok: false, error: "bad_action" };
  const fb = (feedback ?? "").trim();
  if (action === "reject" && !fb) return { ok: false, error: "feedback_required" };
  const db = getServiceSupabase();
  const { data: request } = await db.from("sign_requests")
    .select("id, candidate_user_id, document_name, status").eq("id", signRequestId).maybeSingle();
  if (!request) return { ok: false, error: "not_found" };
  const r = request as { candidate_user_id: string; document_name: string; status: string };
  if (r.status !== "signed") return { ok: false, error: "not_signed_yet" };
  if (!(await canActOnCandidate(scope.role, scope.email, r.candidate_user_id))) return { ok: false, error: "out_of_scope" };
  const { error } = await db.from("sign_requests").update({
    review_status: action === "accept" ? "accepted" : "rejected",
    review_feedback: action === "reject" ? fb : null,
  }).eq("id", signRequestId);
  if (error) return { ok: false, error: "write_failed" };
  try {
    await db.from("notifications").insert({
      user_id: r.candidate_user_id, doc_id: signRequestId, doc_name: r.document_name, doc_type: r.document_name,
      action: action === "accept" ? "approved" : "rejected", feedback: action === "reject" ? fb : null, read: false,
    });
  } catch { /* non-fatal */ }
  return { ok: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create or remove a (Borivon HQ) sub-admin — mirrors POST/DELETE
 *  /api/portal/admin/sub-admins. create: collapse any rows for the email (no
 *  unique constraint) then insert one with is_agency_admin:false (schema-
 *  tolerant). remove: delete assignments FIRST, then the row. */
async function writeManageSubAdmin(op: string, email: string, name: string, label: string): Promise<WriteResult> {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: "bad_email" };
  const db = getServiceSupabase();
  if (op === "create") {
    const { error: dErr } = await db.from("sub_admins").delete().ilike("email", ciEmail(e));
    if (dErr) return { ok: false, error: "write_failed" }; // don't insert + claim success if the de-dupe delete failed
    let { error } = await db.from("sub_admins").insert({ email: e, name: name.slice(0, 200), label: label.slice(0, 200), is_agency_admin: false });
    if (error && /is_agency_admin|column .* does not exist|schema cache/i.test(error.message)) {
      ({ error } = await db.from("sub_admins").insert({ email: e, name: name.slice(0, 200), label: label.slice(0, 200) }));
    }
    if (error && !/duplicate key|unique|already exists|23505/i.test(error.message)) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (op === "remove") {
    const { error: aErr } = await db.from("sub_admin_assignments").delete().eq("sub_admin_email", e);
    if (aErr) return { ok: false, error: "write_failed" };
    const { error } = await db.from("sub_admins").delete().eq("email", e);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  return { ok: false, error: "bad_op" };
}

/** Assign / unassign a candidate to a sub-admin — mirrors POST/DELETE
 *  /api/portal/admin/sub-admins/assign (upsert / delete sub_admin_assignments). */
async function writeAssignCandidate(op: string, subAdminEmail: string, candidateUserId: string): Promise<WriteResult> {
  const e = subAdminEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: "bad_email" };
  if (!UUID_RE.test(candidateUserId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  if (op === "assign") {
    const { error } = await db.from("sub_admin_assignments").upsert(
      { sub_admin_email: e, candidate_user_id: candidateUserId }, { onConflict: "sub_admin_email,candidate_user_id" });
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (op === "unassign") {
    const { error } = await db.from("sub_admin_assignments").delete().eq("sub_admin_email", e).eq("candidate_user_id", candidateUserId);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  return { ok: false, error: "bad_op" };
}

/** Grant / revoke a candidate's manual verification (blue tick) — mirrors POST
 *  /api/portal/admin/verify-user: upsert candidate_profiles.manually_verified;
 *  on grant, send the one-time "verified" notification + email (idempotent). */
async function writeSetVerified(userId: string, verified: boolean): Promise<WriteResult> {
  if (!UUID_RE.test(userId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").upsert(
    { user_id: userId, manually_verified: verified }, { onConflict: "user_id" });
  if (error) return { ok: false, error: "write_failed" };
  if (verified) {
    const { data: existing } = await db.from("notifications").select("id").eq("user_id", userId).eq("action", "verified").limit(1);
    if (!existing?.length) {
      await db.from("notifications").insert({
        user_id: userId, doc_id: null, doc_name: "Verifizierung", doc_type: "Passport",
        action: "verified", feedback: null, read: false,
      });
      try {
        const { data } = await db.auth.admin.getUserById(userId);
        const email = data?.user?.email;
        if (email) {
          const firstName = ((data?.user?.user_metadata?.full_name as string | undefined) ?? "").split(" ")[0];
          await sendVerifiedEmail(email, firstName);
        }
      } catch { /* non-fatal */ }
    }
  }
  return { ok: true };
}

/** Add / change-role / remove an organization member — mirrors POST/PATCH/DELETE
 *  /api/portal/admin/organizations/[id]/members. add: ensure a sub_admins row
 *  (is_agency_admin:true, schema-tolerant) then upsert organization_members.
 *  setRole: update role. remove: delete the membership only (keep sub_admins). */
async function writeManageOrgMember(op: string, orgId: string, email: string, role: string, name: string, label: string): Promise<WriteResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "bad_id" };
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: "bad_email" };
  const db = getServiceSupabase();
  if (op === "add") {
    const r = role === "owner" ? "owner" : "member";
    const { error: dErr } = await db.from("sub_admins").delete().ilike("email", ciEmail(e));
    if (dErr) return { ok: false, error: "write_failed" }; // don't proceed + claim success if the de-dupe delete failed
    let { error: subErr } = await db.from("sub_admins").insert({ email: e, name: name.slice(0, 200), label: label.slice(0, 200), is_agency_admin: true });
    if (subErr && /is_agency_admin|column .* does not exist|schema cache/i.test(subErr.message)) {
      ({ error: subErr } = await db.from("sub_admins").insert({ email: e, name: name.slice(0, 200), label: label.slice(0, 200) }));
    }
    if (subErr && !/duplicate key|unique|already exists|23505/i.test(subErr.message)) return { ok: false, error: "write_failed" };
    const { error } = await db.from("organization_members").upsert({ org_id: orgId, sub_admin_email: e, role: r }, { onConflict: "org_id,sub_admin_email" });
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (op === "setRole") {
    const r = role === "owner" ? "owner" : role === "member" ? "member" : null;
    if (!r) return { ok: false, error: "bad_role" };
    const { error } = await db.from("organization_members").update({ role: r }).eq("org_id", orgId).eq("sub_admin_email", e);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  if (op === "remove") {
    const { error } = await db.from("organization_members").delete().eq("org_id", orgId).eq("sub_admin_email", e);
    if (error) return { ok: false, error: "write_failed" };
    return { ok: true };
  }
  return { ok: false, error: "bad_op" };
}

/** Create a calendar event (or N weekly recurrences) — mirrors the core INSERT
 *  of POST /api/portal/calendar (same field caps, repeat_weekly 1..52, public
 *  by default). Skips the Google-Calendar push (needs the admin's OAuth) — the
 *  event still appears in the portal calendar. */
async function writeCalendarEvent(scope: AssistantScope, opts: { title: string; startsAt: string; endsAt?: string; description?: string; location?: string; linkUrl?: string; vipOnly?: boolean; repeatWeekly?: number }): Promise<WriteResult> {
  const title = opts.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "title_required" };
  const startMs = Date.parse(opts.startsAt);
  if (!Number.isFinite(startMs)) return { ok: false, error: "bad_start" };
  let endMs: number | null = null;
  if (opts.endsAt) { const p = Date.parse(opts.endsAt); if (Number.isFinite(p) && p >= startMs) endMs = p; }
  let link = "";
  if (opts.linkUrl) { const u = opts.linkUrl.trim(); if (/^https?:\/\//i.test(u)) link = u.slice(0, 1000); }
  // calendar_events.{description,image_url,link_url,location} are all `text NOT NULL
  // default ''` — so these MUST be empty strings, never null (a null insert is a
  // NOT NULL violation → the whole create fails). The website API inserts ''
  // for the same reason; mirror it exactly.
  const baseRow = {
    title,
    description: (opts.description ?? "").slice(0, 4000),
    image_url: "",
    link_url: link,
    location: (opts.location ?? "").slice(0, 200),
    vip_only: opts.vipOnly === true,
    attendee_ids: [] as string[],
    created_by: scope.userId,
  };
  const repeat = Math.max(1, Math.min(52, Math.floor(opts.repeatWeekly ?? 1) || 1));
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const rows = Array.from({ length: repeat }, (_, i) => ({
    ...baseRow,
    starts_at: new Date(startMs + i * WEEK).toISOString(),
    ends_at: endMs != null ? new Date(endMs + i * WEEK).toISOString() : null,
  }));
  const db = getServiceSupabase();
  const { error } = await db.from("calendar_events").insert(rows);
  if (error) { console.error("[assistantWrites] createCalendarEvent insert failed:", error.message); return { ok: false, error: "write_failed" }; }
  return { ok: true };
}

/** Delete a calendar event — mirrors DELETE /api/portal/calendar (skips the
 *  best-effort Google-Calendar removal). */
async function writeDeleteCalendarEvent(eventId: string): Promise<WriteResult> {
  if (!UUID_RE.test(eventId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  const { error } = await db.from("calendar_events").delete().eq("id", eventId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

/** Book an event in the FOUNDER'S OWN Google Calendar (native, via domain-wide
 *  delegation) — the calendar they actually look at. Distinct from the portal
 *  community calendar above. */
async function writeBookCalendarEvent(opts: { title: string; startsAt: string; endsAt?: string; description?: string; location?: string; addMeet?: boolean }): Promise<WriteResult> {
  const r = await bookWorkspaceEvent(opts);
  if (!r.ok) {
    // Surface the real reason: not connected vs a genuine API failure.
    return { ok: false, error: r.error === "workspace_not_connected" ? "calendar_not_connected" : "write_failed" };
  }
  // Surface the Meet link so the founder can paste it to the candidate.
  return { ok: true, info: r.meetLink ? `📹 Google Meet: ${r.meetLink}` : undefined };
}

// LAW #31 — supreme-admin stage lock/unlock. Maps the spoken stage name to the
// candidate_pipeline boolean column. `unlocked=true` opens the stage for the
// candidate; `false` locks it. (The generic milestone tool deliberately can't
// reach these columns — only this dedicated tool can.)
export const STAGE_LOCK_COLUMN: Record<string, string> = {
  bearbeitung: "recognition_unlocked", recognition: "recognition_unlocked",
  visum: "embassy_unlocked", embassy: "embassy_unlocked",
  integration: "integration_unlocked", start: "start_unlocked",
};
async function writeStageLock(userId: string, stage: string, unlocked: boolean): Promise<WriteResult> {
  const col = STAGE_LOCK_COLUMN[stage];
  if (!col) return { ok: false, error: "bad_stage" };
  return applyPipelinePatch(userId, { [col]: unlocked });
}

// Permanently delete a partner organization. The FK cascade removes its members
// + unlinks every candidate tied to it (candidate accounts themselves survive).
async function writeDeleteOrganization(orgId: string): Promise<WriteResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  const { error } = await db.from("organizations").delete().eq("id", orgId);
  if (error) return { ok: false, error: "delete_failed" };
  return { ok: true };
}

// Permanently delete a candidate's account + ALL their data. Uses the SAME
// canonical RPC the website's delete-user route runs as its primary path
// (app_delete_user — clears every table FK'd to auth.users(id) + the auth row
// in one transaction; if it fails, nothing was deleted, so this is safe).
async function writeDeleteCandidate(userId: string): Promise<WriteResult> {
  if (!UUID_RE.test(userId)) return { ok: false, error: "bad_id" };
  const db = getServiceSupabase();
  // Capture sign-document Storage blob paths BEFORE the cascade drops their rows
  // (Storage objects aren't reached by the DB FK cascade).
  let blobPaths: string[] = [];
  try {
    const { data: sigReqs } = await db.from("sign_requests")
      .select("pdf_storage_path, signed_pdf_path").eq("candidate_user_id", userId);
    blobPaths = (sigReqs ?? []).flatMap(
      (r: { pdf_storage_path: string | null; signed_pdf_path: string | null }) =>
        [r.pdf_storage_path, r.signed_pdf_path].filter(Boolean) as string[],
    );
  } catch { /* best-effort */ }
  const { error } = await db.rpc("app_delete_user", { p_uid: userId });
  if (error) return { ok: false, error: "delete_failed" };
  // Row gone — drop the now-orphaned Storage blobs (best-effort).
  if (blobPaths.length) { try { await db.storage.from("sign-documents").remove(blobPaths); } catch { /* ignore */ } }
  return { ok: true };
}

// Set a partner org's LOGO from a bot-attached image. The bytes already live in
// R2 (chat-uploads/...) — fetch them back, build a data URL, and store it on
// organizations.logo_filename, EXACTLY as the website's org PATCH does (inline
// data URL, strict image validation, ~300KB cap on the data-URL string). The
// logo then brands that org's candidate CVs (agency branding) + footer.
async function writeUploadOrgLogo(orgId: string, r2Key: string, mime: string): Promise<WriteResult> {
  if (!UUID_RE.test(orgId)) return { ok: false, error: "bad_id" };
  const obj = r2Key ? await r2GetObject(r2Key) : null;
  if (!obj?.body) return { ok: false, error: "file_missing" };
  const dataUrl = `data:${(mime || "image/png").toLowerCase()};base64,${obj.body.toString("base64")}`;
  if (dataUrl.length > 307_200) return { ok: false, error: "logo_too_large" }; // mirrors the route's ~300KB cap
  if (!validateImageDataUrl(dataUrl).ok) return { ok: false, error: "invalid_image" }; // PNG/JPEG/WebP/GIF only, no SVG/script
  const db = getServiceSupabase();
  const { error } = await db.from("organizations").update({ logo_filename: dataUrl }).eq("id", orgId);
  if (error) return { ok: false, error: "write_failed" };
  return { ok: true };
}

// Set a candidate's ACADEMY CEFR level — mirrors the academy admin route's
// set_level action: updates current_level in their ACTIVE cohort (auto-resolved,
// so the admin needn't know the cohortId) and, when climbing UP, awards the
// one-time level_up points (idempotent per target level) + pings the student.
const ACADEMY_LEVELS = ["A1", "A2", "B1", "B2"] as const;
const LEVEL_UP_EVENT: Record<string, string> = {
  A2: "a2000000-0000-4000-8000-000000000002",
  B1: "b1000000-0000-4000-8000-000000000001",
  B2: "b2000000-0000-4000-8000-000000000002",
};
async function writeAcademyLevel(userId: string, level: string): Promise<WriteResult> {
  if (!(ACADEMY_LEVELS as readonly string[]).includes(level)) return { ok: false, error: "bad_level" };
  const db = getServiceSupabase();
  const { data: mem } = await db.from("academy_cohort_members")
    .select("cohort_id, current_level").eq("candidate_user_id", userId).eq("status", "active").maybeSingle();
  const m = mem as { cohort_id: string; current_level: string | null } | null;
  if (!m) return { ok: false, error: "not_enrolled" };
  const oldLevel = m.current_level ?? "A1";
  const { error } = await db.from("academy_cohort_members")
    .update({ current_level: level }).eq("cohort_id", m.cohort_id).eq("candidate_user_id", userId);
  if (error) return { ok: false, error: "write_failed" };
  const lvls = ACADEMY_LEVELS as readonly string[];
  if (lvls.indexOf(level) > lvls.indexOf(oldLevel) && LEVEL_UP_EVENT[level]) {
    try {
      const { awardPoints } = await import("@/lib/academyPoints");
      await awardPoints({ candidateUserId: userId, cohortId: m.cohort_id, type: "level_up", sourceKind: "system", sourceId: LEVEL_UP_EVENT[level], meta: { level } });
      serverBroadcast(`academy:${userId}`, "points", { reason: "level_up", level }).catch(() => {});
    } catch { /* points are best-effort — the level change already persisted */ }
  }
  return { ok: true };
}

// ── Batch Board ──────────────────────────────────────────────────────────────
// Create / edit / close an employer intake batch (employer_batches).
async function writeManageBatch(opts: { op: string; batchId?: string; employerId?: string; name?: string; seats?: number; targetStart?: string; targetEnd?: string; notes?: string; close?: boolean }): Promise<WriteResult> {
  const db = getServiceSupabase();
  if (opts.op === "create") {
    if (!opts.name) return { ok: false, error: "name_required" };
    const row: Record<string, unknown> = { name: opts.name, seats: opts.seats && opts.seats > 0 ? opts.seats : 10 };
    if (opts.employerId) row.employer_id = opts.employerId;
    if (opts.targetStart) row.target_start = opts.targetStart;
    if (opts.targetEnd) row.target_end = opts.targetEnd;
    if (opts.notes) row.notes = opts.notes;
    const { error } = await db.from("employer_batches").insert(row);
    return error ? { ok: false, error: "write_failed" } : { ok: true };
  }
  if (!opts.batchId || !UUID_RE.test(opts.batchId)) return { ok: false, error: "bad_id" };
  const upd: Record<string, unknown> = {};
  if (opts.name !== undefined) upd.name = opts.name;
  if (opts.seats !== undefined && opts.seats > 0) upd.seats = opts.seats;
  if (opts.employerId !== undefined) upd.employer_id = opts.employerId || null;
  if (opts.targetStart !== undefined) upd.target_start = opts.targetStart || null;
  if (opts.targetEnd !== undefined) upd.target_end = opts.targetEnd || null;
  if (opts.notes !== undefined) upd.notes = opts.notes || null;
  if (opts.close) upd.status = "closed";
  if (Object.keys(upd).length === 0) return { ok: false, error: "nothing_to_update" };
  const { error } = await db.from("employer_batches").update(upd).eq("id", opts.batchId);
  return error ? { ok: false, error: "write_failed" } : { ok: true };
}

// Set a candidate's funnel stage and/or batch (candidate_pipeline columns).
async function writeFunnelStage(userId: string, stage: string | undefined, batchId: string | null | undefined): Promise<WriteResult> {
  const fields: Record<string, unknown> = {};
  if (stage !== undefined) {
    if (!isFunnelStage(stage)) return { ok: false, error: "bad_stage" };
    fields.funnel_stage = stage;
  }
  if (batchId !== undefined) {
    if (batchId && !UUID_RE.test(batchId)) return { ok: false, error: "bad_batch_id" };
    fields.batch_id = batchId || null;
  }
  if (Object.keys(fields).length === 0) return { ok: false, error: "nothing_to_set" };
  return applyPipelinePatch(userId, fields);
}

// Stamp last_touch_at so a warmed candidate drops off the "cold" list. Best-effort
// — silently no-ops if the column isn't migrated yet. Called after a nudge/message.
async function stampTouch(userIds: string[]): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  try {
    await getServiceSupabase().from("candidate_pipeline").update({ last_touch_at: new Date().toISOString() }).in("user_id", ids);
  } catch { /* column not migrated → ignore */ }
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
  // The model often RE-STAGES the same action on the very turn the admin confirms
  // ("yes"/"Senden") — re-calling the staging tool before confirmPendingWrite. If
  // we restamped __stagedReq with the CURRENT request every time, the same-turn
  // anti-injection guard in executeLatestPending would refuse the confirm forever
  // and the admin could NEVER get it to run (this is what made "send the email"
  // silently never send). So: if the newest pending is the IDENTICAL action
  // (same tool + same args), treat the re-stage as a NO-OP — keep the original
  // row and its original __stagedReq (set in an earlier turn) so a later-turn
  // confirm is allowed. A genuinely NEW/changed action still cancels the old and
  // stamps the current request, so staging+confirming a new action in ONE turn
  // stays blocked (the injection case is unchanged).
  const sig = (a: Record<string, unknown> | undefined) => {
    const { __stagedReq, ...rest } = (a ?? {}) as Record<string, unknown>;
    void __stagedReq;
    return JSON.stringify(rest);
  };
  const { data: prior } = await db.from("assistant_pending_actions")
    .select("tool_name, args").eq("owner_user_id", scope.userId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const priorRow = prior as { tool_name: string; args: Record<string, unknown> } | null;
  if (priorRow && priorRow.tool_name === opts.toolName && sig(priorRow.args) === sig(opts.args)) {
    return { staged: true, summary: opts.summary }; // identical re-stage → keep the existing pending untouched
  }

  // For a DESTRUCTIVE action (needs an explicit 'yes'), drop older pending so the
  // 'yes' is unambiguous. For NON-destructive actions, KEEP the siblings — the
  // model often stages several in ONE turn (e.g. message 4 candidates, set B2 for
  // a few) and autoApplyPending drains them ALL; cancelling siblings here silently
  // dropped every one but the last (a real bug the audit caught).
  if (DESTRUCTIVE_TOOLS.has(opts.toolName)) {
    await db.from("assistant_pending_actions").update({ status: "cancelled" })
      .eq("owner_user_id", scope.userId).eq("status", "pending");
  }
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
  opts?: { allowSameTurn?: boolean },
): Promise<{ done: true; summary: string } | { error: string }> {
  const row = await getLatestPending(scope.userId);
  if (!row) return { error: "nothing_pending" };
  return applyPendingRow(scope, row, opts);
}

/** Apply ONE specific staged row: anti-injection guard + serve-time scope recheck
 *  + dispatch + mark confirmed. Shared by executeLatestPending (the human "yes"
 *  path) and autoApplyPending (which drains ALL non-destructive actions staged
 *  this turn, so a multi-action message — "message all 4" — applies every one). */
async function applyPendingRow(
  scope: AssistantScope,
  row: PendingRow,
  opts?: { allowSameTurn?: boolean },
): Promise<{ done: true; summary: string } | { error: string }> {
  // Anti-injection: a write may NOT be confirmed in the same request that staged
  // it. The model loops up to ~8 tool calls per inbound message, so without this
  // it could stage AND call confirmPendingWrite in one turn — skipping the human
  // checkpoint (e.g. driven by an instruction injected into a candidate's data).
  // Confirmation must come from a LATER admin message (a fresh requestId).
  // EXCEPTION: the auto-apply path (allowSameTurn) deliberately runs a just-staged
  // NON-destructive action in the same turn — that's the "just do it, no yes/no"
  // behaviour the founder wants. Destructive actions never take this path
  // (autoApplyPending refuses them), so they still require a separate human "yes".
  const stagedReq = (row.args as Record<string, unknown> | null)?.__stagedReq;
  if (!opts?.allowSameTurn && stagedReq && scope.requestId && stagedReq === scope.requestId) {
    return { error: "confirm_in_new_message" };
  }
  // Serve-time scope re-check (defense-in-depth).
  if (row.candidate_user_id && !(await canActOnCandidate(scope.role, scope.email, row.candidate_user_id))) {
    const db = getServiceSupabase();
    await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", row.id);
    return { error: "out_of_scope" };
  }
  const a = row.args;
  let result: WriteResult = { ok: false, error: "unknown_tool" };
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
      cc: splitIds(a.cc),
      subject: String(a.subject ?? ""),
      body: String(a.body ?? ""),
      candidateIds: splitIds(a.attachCandidateIds),
      docIds: splitIds(a.attachDocIds),
      attachFromEmailIds: splitIds(a.attachFromEmailIds),
    });
  } else if (row.tool_name === "replyToEmail") {
    result = await writeReplyEmail(scope, { messageId: String(a.messageId ?? ""), body: String(a.body ?? ""), replyAll: a.replyAll === true });
  } else if (row.tool_name === "sendCalendarInvite") {
    const emails = String(a.attendees ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    result = await writeCalendarInvite({
      attendees: emails,
      title: String(a.title ?? ""),
      startsAt: String(a.startsAt ?? ""),
      endsAt: a.endsAt == null ? undefined : String(a.endsAt),
      durationMinutes: typeof a.durationMinutes === "number" ? a.durationMinutes : undefined,
      location: a.location == null ? undefined : String(a.location),
      description: a.description == null ? undefined : String(a.description),
      method: a.method === "cancel" ? "CANCEL" : "REQUEST",
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
  } else if (row.tool_name === "reviewOrgRequest") {
    result = await writeOrgRequest(scope, String(a.candidateUserId), String(a.orgId), String(a.decision ?? ""));
  } else if (row.tool_name === "decideSuggestedMatch") {
    result = await writeSuggestedMatch(scope, String(a.matchId), String(a.action ?? ""));
  } else if (row.tool_name === "manageOrganization") {
    result = await writeManageOrganization({
      op: String(a.op ?? ""),
      orgId: a.orgId == null ? undefined : String(a.orgId),
      name: a.name == null ? undefined : String(a.name),
      notes: a.notes == null ? undefined : String(a.notes),
      inviteCode: a.inviteCode == null ? undefined : String(a.inviteCode),
    });
  } else if (row.tool_name === "setOrgBranding") {
    result = await writeOrgBranding(String(a.orgId), {
      footerText: a.footerText == null ? undefined : String(a.footerText),
      masern: a.masern == null ? undefined : Number(a.masern),
      varizell: a.varizell == null ? undefined : Number(a.varizell),
    });
  } else if (row.tool_name === "manageOrgRequirement") {
    result = await writeOrgRequirement({
      op: String(a.op ?? ""),
      orgId: a.orgId == null ? undefined : String(a.orgId),
      requirementId: a.requirementId == null ? undefined : String(a.requirementId),
      specialty: a.specialty == null ? undefined : String(a.specialty),
      slots: a.slots == null ? undefined : Number(a.slots),
      location: a.location == null ? undefined : String(a.location),
      startDate: a.startDate == null ? undefined : String(a.startDate),
      notes: a.notes == null ? undefined : String(a.notes),
    });
  } else if (row.tool_name === "sendSlotRequest") {
    result = await writeSlotNotify(String(a.slotId), String(a.candidateUserId), a.needsSign === true, a.needsFill === true);
  } else if (row.tool_name === "reviewSignRequest") {
    result = await writeSignRequestReview(scope, String(a.signRequestId), String(a.action ?? ""), a.feedback == null ? null : String(a.feedback));
  } else if (row.tool_name === "manageSubAdmin") {
    result = await writeManageSubAdmin(String(a.op ?? ""), String(a.email ?? ""), a.name == null ? "" : String(a.name), a.label == null ? "" : String(a.label));
  } else if (row.tool_name === "assignCandidate") {
    result = await writeAssignCandidate(String(a.op ?? ""), String(a.subAdminEmail ?? ""), String(a.candidateUserId ?? ""));
  } else if (row.tool_name === "setCandidateVerified") {
    result = await writeSetVerified(String(a.userId ?? ""), a.verified === true);
  } else if (row.tool_name === "manageOrgMember") {
    result = await writeManageOrgMember(String(a.op ?? ""), String(a.orgId ?? ""), String(a.email ?? ""), a.role == null ? "" : String(a.role), a.name == null ? "" : String(a.name), a.label == null ? "" : String(a.label));
  } else if (row.tool_name === "createCalendarEvent") {
    result = await writeCalendarEvent(scope, {
      title: String(a.title ?? ""),
      startsAt: String(a.startsAt ?? ""),
      endsAt: a.endsAt == null ? undefined : String(a.endsAt),
      description: a.description == null ? undefined : String(a.description),
      location: a.location == null ? undefined : String(a.location),
      linkUrl: a.linkUrl == null ? undefined : String(a.linkUrl),
      vipOnly: a.vipOnly === true,
      repeatWeekly: a.repeatWeekly == null ? undefined : Number(a.repeatWeekly),
    });
  } else if (row.tool_name === "bookCalendarEvent") {
    result = await writeBookCalendarEvent({
      title: String(a.title ?? ""),
      startsAt: String(a.startsAt ?? ""),
      endsAt: a.endsAt == null ? undefined : String(a.endsAt),
      description: a.description == null ? undefined : String(a.description),
      location: a.location == null ? undefined : String(a.location),
      addMeet: a.addMeet === true,
    });
  } else if (row.tool_name === "deleteCalendarEvent") {
    result = await writeDeleteCalendarEvent(String(a.eventId ?? ""));
  } else if (row.tool_name === "toggleStageLock") {
    result = await writeStageLock(String(a.candidateUserId), String(a.stage ?? ""), a.unlocked === true);
  } else if (row.tool_name === "deleteOrganization") {
    result = await writeDeleteOrganization(String(a.orgId ?? ""));
  } else if (row.tool_name === "deleteCandidateAccount") {
    result = await writeDeleteCandidate(String(a.candidateUserId));
  } else if (row.tool_name === "setAcademyLevel") {
    result = await writeAcademyLevel(String(a.candidateUserId), String(a.level ?? ""));
  } else if (row.tool_name === "uploadOrgLogo") {
    result = await writeUploadOrgLogo(String(a.orgId ?? ""), String(a.r2Key ?? ""), String(a.mime ?? ""));
  } else if (row.tool_name === "manageBatch") {
    result = await writeManageBatch({
      op: String(a.op ?? ""),
      batchId: a.batchId == null ? undefined : String(a.batchId),
      employerId: a.employerId === undefined ? undefined : a.employerId == null ? "" : String(a.employerId),
      name: a.name == null ? undefined : String(a.name),
      seats: a.seats == null ? undefined : Number(a.seats),
      targetStart: a.targetStart == null ? undefined : String(a.targetStart),
      targetEnd: a.targetEnd == null ? undefined : String(a.targetEnd),
      notes: a.notes == null ? undefined : String(a.notes),
      close: a.close === true,
    });
  } else if (row.tool_name === "setFunnelStage") {
    result = await writeFunnelStage(
      String(a.candidateUserId),
      a.stage == null ? undefined : String(a.stage),
      a.batchId === undefined ? undefined : a.batchId == null ? null : String(a.batchId),
    );
  }
  if (!result.ok) {
    // Surface SILENT write failures (e.g. the calendar NOT-NULL bug) to the alarm.
    // These are CAUGHT and returned, not thrown — so onRequestError never sees
    // them. Routing them here means the founder gets pinged the moment one of his
    // actions silently fails, instead of discovering it days later by accident.
    reportError(new Error(`assistant write failed: ${row.tool_name} → ${result.error}`), {
      route: "assistant/applyPendingRow",
      tool: row.tool_name,
    });
    return { error: result.error };
  }
  // Retention: warming a candidate (nudge/message) stamps last_touch_at so the
  // all-day nudger won't re-nag you about someone you just contacted today.
  if (row.tool_name === "sendFollowUpNudge" || row.tool_name === "sendCandidateMessage") {
    if (a.candidateUserId) await stampTouch([String(a.candidateUserId)]);
  } else if (row.tool_name === "nudgeStuckCandidates") {
    await stampTouch(Array.isArray(a.candidateIds) ? (a.candidateIds as unknown[]).map((x) => String(x)) : []);
  }
  const db = getServiceSupabase();
  await db.from("assistant_pending_actions").update({ status: "confirmed" }).eq("id", row.id);
  // Append any extra info the write produced (e.g. a freshly-minted Meet link).
  const summary = result.info ? `${row.summary}\n${result.info}` : row.summary;
  return { done: true, summary };
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

// Actions that WAIT for an explicit human "yes" before running. Two groups:
//  • DESTRUCTIVE — irreversible deletes (a competent assistant double-checks).
//  • SEND — anything that transmits a message to a PERSON. This is the ONE
//    guardrail the founder wants: confirm before it goes out ("send X to Y?").
// EVERYTHING ELSE auto-applies instantly — no yes/no robot, just act.
export const DESTRUCTIVE_TOOLS = new Set<string>(["deleteCandidateAccount", "deleteOrganization"]);
export const SEND_TOOLS = new Set<string>([
  "sendExternalEmail", "sendCandidateMessage", "sendFollowUpNudge", "nudgeStuckCandidates", "sendSlotRequest",
  "sendCalendarInvite", "replyToEmail",
]);
const CONFIRM_TOOLS = new Set<string>([...DESTRUCTIVE_TOOLS, ...SEND_TOOLS]);

export type AwaitingConfirm = { summary: string; isSend: boolean };
export type AutoApplyResult =
  | { applied: string[]; failed: string[]; awaitingConfirm: AwaitingConfirm | null }
  | { skipped: "nothing"; awaitingConfirm: AwaitingConfirm | null };

/** Is there a staged action still waiting for the human "yes"? (oldest first) */
async function findAwaitingConfirm(userId: string): Promise<AwaitingConfirm | null> {
  const db = getServiceSupabase();
  const { data } = await db.from("assistant_pending_actions")
    .select("tool_name, summary, expires_at")
    .eq("owner_user_id", userId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(20);
  const rows = ((data ?? []) as { tool_name: string; summary: string; expires_at: string }[])
    .filter((r) => new Date(r.expires_at).getTime() >= Date.now());
  const c = rows.find((r) => CONFIRM_TOOLS.has(r.tool_name));
  return c ? { summary: c.summary, isSend: SEND_TOOLS.has(c.tool_name) } : null;
}

/**
 * "Just do it" — apply every staged action immediately (same turn), EXCEPT a send
 * to a person or an irreversible delete (those wait for an explicit "yes"). Called
 * by the Telegram webhook right after the model runs, so the admin talks naturally
 * and non-send actions just happen — while a send always pauses for confirmation.
 */
export async function autoApplyPending(scope: AssistantScope): Promise<AutoApplyResult> {
  if (!scope.userId) return { skipped: "nothing", awaitingConfirm: null };
  const db = getServiceSupabase();
  const applied: string[] = [];
  const failed: string[] = [];
  // Drain EVERY pending NON-confirm action staged this turn (oldest first), so
  // "set B2 for these 3" applies them ALL. Sends + deletes are left pending.
  for (let i = 0; i < 20; i++) {
    const { data } = await db.from("assistant_pending_actions")
      .select("id, tool_name, args, candidate_user_id, summary, expires_at")
      .eq("owner_user_id", scope.userId).eq("status", "pending")
      .order("created_at", { ascending: true }).limit(20);
    const rows = ((data ?? []) as PendingRow[]).filter((r) => new Date(r.expires_at).getTime() >= Date.now());
    const next = rows.find((r) => !CONFIRM_TOOLS.has(r.tool_name));
    if (!next) break; // only confirm-required left (awaiting 'yes'), or nothing pending
    const r = await applyPendingRow(scope, next, { allowSameTurn: true });
    if ("done" in r) {
      applied.push(next.summary);
    } else {
      failed.push(r.error);
      await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", next.id);
    }
  }
  const awaitingConfirm = await findAwaitingConfirm(scope.userId);
  if (applied.length === 0 && failed.length === 0) return { skipped: "nothing", awaitingConfirm };
  return { applied, failed, awaitingConfirm };
}
