/**
 * PUBLIC, login-less one-time upload endpoint.
 *   GET  /api/portal/u/<token>  → { firstName, docs:[{key,uploaded}] } or 404
 *   POST /api/portal/u/<token>  → multipart { file, docKey } → stores the doc
 *
 * AUTH IS THE TOKEN, nothing else (mirrors app/api/book/manage): validated by
 * SHAPE before any DB hit, looked up by sha256 hash, rate-limited, and any
 * unknown/expired/used/revoked token returns the SAME generic 404 (a leaked link
 * reveals nothing). The candidate + allowed doc keys come from the LINK ROW, never
 * from the request — a link for doc X on candidate A can't write doc Y or to B.
 *
 * The write mirrors POST /api/portal/upload: R2 + a `documents` row (status
 * "pending" — LAW #3/#15, admin still reviews) + an `admin_notifications` row so
 * the doc shows in the dashboard normally. LAW #39: passport ("id") is excluded
 * from links, so no passport bytes are ever handled here.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { looksLikeUploadToken, hashUploadToken } from "@/lib/uploadLink";
import { buildFileName, isUploadLinkKey } from "@/lib/uploadName";
import { candidateKey, r2Put, r2Configured } from "@/lib/r2";
import { shouldSupersedePrevious, idsToRetire } from "@/lib/slotSupersede";
import { FILE_KEY_LABELS, resolveFileKey } from "@/lib/fileKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

type LinkRow = {
  id: string; candidate_user_id: string; doc_keys: string[]; uploaded_keys: string[] | null;
};

/** Resolve a token to a live link row, fail-closed. Null on ANY problem. */
async function resolveLink(token: string): Promise<LinkRow | null> {
  if (!looksLikeUploadToken(token)) return null;
  const hash = await hashUploadToken(token);
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("upload_links")
    .select("id, candidate_user_id, doc_keys, uploaded_keys, expires_at, used_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as LinkRow & { expires_at: string; used_at: string | null; revoked_at: string | null };
  if (row.revoked_at) return null;
  if (row.used_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, candidate_user_id: row.candidate_user_id, doc_keys: row.doc_keys ?? [], uploaded_keys: row.uploaded_keys ?? [] };
}

/** Server-derived candidate identity (never from the request). */
async function candidateInfo(userId: string): Promise<{ firstName: string; lastName: string; fullName: string; email: string }> {
  const db = getServiceSupabase();
  let firstName = "", lastName = "", fullName = "", email = "";
  try {
    const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", userId).maybeSingle();
    const p = data as { first_name?: string | null; last_name?: string | null } | null;
    firstName = (p?.first_name ?? "").trim();
    lastName = (p?.last_name ?? "").trim();
  } catch { /* fall through to auth */ }
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    email = data?.user?.email ?? "";
    const meta = (data?.user?.user_metadata ?? {}) as { full_name?: string; first_name?: string; last_name?: string };
    fullName = (meta.full_name ?? "").trim();
    if (!firstName) firstName = (meta.first_name ?? fullName.split(/\s+/)[0] ?? "").trim();
    if (!lastName) lastName = (meta.last_name ?? fullName.split(/\s+/).slice(1).join(" ") ?? "").trim();
  } catch { /* best-effort */ }
  if (!fullName) fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return { firstName, lastName, fullName, email };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "u-view", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NOT_FOUND();
  const { firstName } = await candidateInfo(link.candidate_user_id);
  const done = new Set(link.uploaded_keys ?? []);
  return NextResponse.json({
    firstName,
    docs: link.doc_keys.map((k) => ({ key: k, uploaded: done.has(k) })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "u-upload", { limit: 8, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NOT_FOUND();

  // Reject an oversized body BEFORE buffering it into the isolate (Workers OOM
  // guard; mirrors app/api/portal/upload). The browser/Uppy sets content-length.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_BYTES + 2 * 1024 * 1024)
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid form" }, { status: 400 }); }
  const file = form.get("file") as File | null;
  const docKey = String(form.get("docKey") ?? "");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  // SCOPE: the key must be one this link was minted for (never trust the request).
  if (!isUploadLinkKey(docKey) || !link.doc_keys.includes(docKey))
    return NextResponse.json({ error: "This document isn't part of your link." }, { status: 403 });

  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });

  // Magic-byte sniff (don't trust the declared type).
  const b = buf.subarray(0, 12);
  const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  const isJpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  const sniffedOk = isPdf || isJpg || isPng || isWebp;
  if (!ALLOWED.has(file.type) || !sniffedOk)
    return NextResponse.json({ error: "Only PDF or photo (JPG/PNG/WebP) files are allowed." }, { status: 415 });

  if (!r2Configured()) return NextResponse.json({ error: "Storage unavailable" }, { status: 500 });

  const db = getServiceSupabase();
  // ATOMIC once-per-key claim BEFORE any R2/DB/notify work: the .not(...cs...)
  // predicate lets only ONE request flip docKey from absent→present in
  // uploaded_keys, so concurrent same-key POSTs can't each flood R2 / documents /
  // notifications (the loser matches 0 rows → graceful no-op). Fail-closed on a
  // used/revoked link. On a later R2/DB failure we release the claim so the
  // candidate can retry. (docKey is isUploadLinkKey-validated → safe in the array literal.)
  const claimedKeys = [...new Set([...(link.uploaded_keys ?? []), docKey])];
  const { data: claim } = await db.from("upload_links")
    .update({ uploaded_keys: claimedKeys })
    .eq("id", link.id).is("used_at", null).is("revoked_at", null)
    .not("uploaded_keys", "cs", `{${docKey}}`)
    .select("id");
  if (!claim || claim.length === 0) return NextResponse.json({ ok: true, alreadyUploaded: true });
  const releaseClaim = async () => {
    try { await db.from("upload_links").update({ uploaded_keys: link.uploaded_keys ?? [] }).eq("id", link.id); }
    catch { /* best-effort rollback */ }
  };

  const { firstName, lastName, fullName, email } = await candidateInfo(link.candidate_user_id);
  const ext = isPdf ? "pdf" : isPng ? "png" : isWebp ? "webp" : "jpg";
  const structuredName = buildFileName(firstName, lastName, docKey, ext);
  const fileLabel = FILE_KEY_LABELS[docKey]?.[0] ?? docKey; // resolveFileKey maps this back to the key
  const fileSha256 = createHash("sha256").update(buf).digest("hex");

  const r2Key = candidateKey(link.candidate_user_id, `${Date.now()}_${structuredName}`);
  try { await r2Put(r2Key, buf, file.type || "application/octet-stream"); }
  catch (e) { console.error("[u upload] r2Put", e); await releaseClaim(); return NextResponse.json({ error: "Upload failed" }, { status: 500 }); }

  const baseRow = {
    user_id: link.candidate_user_id,
    file_name: structuredName,
    file_path: `r2/${link.candidate_user_id}/${Date.now()}`,
    file_type: fileLabel,
    drive_file_id: null,
    r2_key: r2Key,
    uploaded_by_admin: false, // candidate-originated → status "pending", admin reviews (LAW #3/#15)
    status: "pending",
  };
  let insertedId: string | null = null;
  {
    const { data, error } = await db.from("documents").insert({ ...baseRow, file_sha256: fileSha256 }).select("id").maybeSingle();
    if (error) {
      // schema-tolerant: retry without file_sha256 if that column is missing
      const { data: d2, error: e2 } = await db.from("documents").insert(baseRow).select("id").maybeSingle();
      if (e2) { console.error("[u upload] documents insert", e2.message); await releaseClaim(); return NextResponse.json({ error: "Save failed" }, { status: 500 }); }
      insertedId = (d2 as { id: string } | null)?.id ?? null;
    } else {
      insertedId = (data as { id: string } | null)?.id ?? null;
    }
  }

  // Supersede prior live rows in the same slot (LAW #33/#15 archive, DB side).
  if (insertedId && shouldSupersedePrevious(docKey)) {
    try {
      const { data: existing } = await db.from("documents").select("id, superseded_at, file_type").eq("user_id", link.candidate_user_id);
      // Match the slot by canonical fileKey so a prior upload in ANOTHER language
      // label (e.g. a rejected diploma) is still retired — no duplicate rows.
      const sameSlot = (existing ?? []).filter((d) => resolveFileKey((d as { file_type: string | null }).file_type) === docKey) as { id: string; superseded_at?: string | null }[];
      const retire = idsToRetire(sameSlot, insertedId);
      if (retire.length) await db.from("documents").update({ superseded_at: new Date().toISOString() }).in("id", retire);
    } catch (e) { console.warn("[u upload] supersede (non-fatal)", e); }
  }

  // Ring the admin bell exactly like a normal candidate upload.
  try {
    await db.from("admin_notifications").insert({
      type: "upload",
      user_name: fullName || "Kandidat",
      user_email: email,
      doc_type: fileLabel,
      doc_name: structuredName,
    });
  } catch (e) { console.warn("[u upload] notify (non-fatal)", e); }

  // uploaded_keys was already set atomically by the claim above. If every
  // requested doc is now in, retire the link (single-use).
  const allDone = link.doc_keys.every((k) => claimedKeys.includes(k));
  if (allDone) {
    try { await db.from("upload_links").update({ used_at: new Date().toISOString() }).eq("id", link.id); }
    catch (e) { console.warn("[u upload] link used_at (non-fatal)", e); }
  }
  const remaining = link.doc_keys.filter((k) => !claimedKeys.includes(k));
  return NextResponse.json({ ok: true, uploaded: claimedKeys, remaining, done: allDone });
}
