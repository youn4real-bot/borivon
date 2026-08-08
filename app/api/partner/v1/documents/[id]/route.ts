import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requirePartner, isSharedWithPartner, logPartnerAccess } from "@/lib/partnerAuth";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { r2GetObject } from "@/lib/r2";
import { UUID_RE } from "@/lib/uuid";

/**
 * GET /api/partner/v1/documents/<id>
 *
 * The file itself. Streams the ORIGINAL stored bytes — no rotation, no
 * re-encoding, no pdf-lib round trip (LAW #39: loading and re-saving a
 * scanner-produced passport silently destroys its machine-readable zone, and a
 * German clinic's reader would then reject it).
 *
 * Three things must all hold, and each answers 404 rather than 403, so the API
 * can never be used to work out who is on our books:
 *   - the document exists and is approved and not archived
 *   - its owner has been shared with THIS agency
 *   - the bytes are actually in storage
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await requirePartner(req);
  if (!auth.ok) {
    await logPartnerAccess({ keyId: null, orgId: null, path: `/documents/${id}`, status: auth.status });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rl = await enforceRateLimitDistributed(req, "partner-api", { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    await logPartnerAccess({ keyId: auth.keyId, orgId: auth.orgId, path: `/documents/${id}`, status: 429 });
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const notFound = async (docId: string | null, owner: string | null) => {
    await logPartnerAccess({
      keyId: auth.keyId, orgId: auth.orgId, path: `/documents/${id}`,
      documentId: docId, candidateUserId: owner, status: 404,
    });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  };

  if (!UUID_RE.test(id)) return notFound(null, null);

  const db = getServiceSupabase();
  const { data } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, r2_key, status, superseded_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return notFound(null, null);

  const doc = data as {
    id: string; user_id: string; file_name: string | null; file_type: string | null;
    r2_key: string | null; status: string | null; superseded_at: string | null;
  };

  // Approved + live only — same rule as the listing, enforced again here so a
  // guessed id cannot reach a rejected or replaced file.
  if (doc.status !== "approved" || doc.superseded_at) return notFound(doc.id, doc.user_id);

  // THE GATE: was this person actually shared with this agency?
  if (!(await isSharedWithPartner(auth.orgId, doc.user_id))) return notFound(doc.id, doc.user_id);

  if (!doc.r2_key) return notFound(doc.id, doc.user_id);

  // A STORAGE failure is not a 404.
  //
  // r2GetObject THROWS when storage is unreachable, which would otherwise
  // escape as an unhandled 500 with a stack trace. Worse, answering 404 here
  // would be a lie with consequences: the integration guide tells the partner
  // that 404 means "not shared, do not retry", so a transient outage would read
  // to their system as "she was withdrawn" — and they might delete their copy.
  // 502 says "our side, try again", which is the truth.
  let obj: Awaited<ReturnType<typeof r2GetObject>> = null;
  try {
    obj = await r2GetObject(doc.r2_key);
  } catch (e) {
    console.error("[partner documents] storage read failed:", e instanceof Error ? e.message : e);
    await logPartnerAccess({
      keyId: auth.keyId, orgId: auth.orgId, path: `/documents/${id}`,
      documentId: doc.id, candidateUserId: doc.user_id, status: 502,
    });
    return NextResponse.json({ error: "storage_unavailable" }, { status: 502 });
  }
  // An empty object is a MISSING file, not an empty document — the same trap
  // that had one candidate's diploma reading as "waiting for review" for months.
  if (!obj || !obj.body.length) return notFound(doc.id, doc.user_id);

  await logPartnerAccess({
    keyId: auth.keyId, orgId: auth.orgId, path: `/documents/${id}`,
    documentId: doc.id, candidateUserId: doc.user_id, status: 200,
  });

  const filename = (doc.file_name ?? "document.pdf").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": obj.contentType ?? "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never let a shared cache hold a candidate's passport.
      "Cache-Control": "private, no-store, must-revalidate",
    },
  });
}
