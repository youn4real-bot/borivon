import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { looksLikeEmail } from "@/lib/booking";

/**
 * LEAD → POOL. The missing hop in Borivon's own funnel.
 *
 * A nurse hits WhatsApp or books a call. Today that produces a `leads` row and
 * nothing else: the Pool lives in `candidate_pipeline`, which is keyed on a real
 * auth user, so a lead can never appear there. `leads.converted_at` and
 * `leads.candidate_user_id` have existed since the table was created and nothing
 * has ever written them — the conversion was designed and never built. Result:
 * 15 people sit in the Pool with not one step ticked, while real leads pile up
 * in a separate list.
 *
 * This closes it. One call turns a lead into a Pool candidate the founder can
 * actually work through Contact → Call → CV → Medical, and later drop into a
 * batch when a hospital asks for slots.
 *
 * NO EMAIL IS SENT. The account is created quietly so the person can be tracked
 * from the moment they make contact; inviting them to the portal is a separate,
 * deliberate act. Tracking somebody and emailing them are different decisions
 * and shouldn't be welded to one button.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find an existing auth user by email, without listing the whole table. */
async function findUserByEmail(email: string): Promise<string | null> {
  const db = getServiceSupabase();
  // listUsers has no server-side email filter, so page until found. Borivon's
  // user count is in the hundreds — this stays cheap and is called once, by hand.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Supreme admin only: this CREATES accounts and decides who Borivon is
  // working. Not a call for an agency's staff, or a sub-admin.
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const db = getServiceSupabase();

  // Two ways in: straight from the Leads list, or from a booking. A booking is
  // just a lead who also picked a time, so it resolves to the same path — and
  // if it has no lead row yet (an admin-entered WhatsApp booking never creates
  // one), we mint it, so EVERY pool candidate still traces back to a lead.
  let leadId = String(body?.leadId ?? "").trim();
  const bookingId = Number(body?.bookingId);

  if (!leadId && Number.isInteger(bookingId) && bookingId > 0) {
    const { data: bk } = await db
      .from("bookings")
      .select("id,kind,name,email,phone,company,lead_id,starts_at")
      .eq("id", bookingId)
      .maybeSingle();
    if (!bk) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
    const b = bk as {
      id: number; kind: string; name: string; email: string | null;
      phone: string | null; company: string | null; lead_id: string | null; starts_at: string;
    };
    // Only a NURSE belongs in the candidate pool. A clinic or a company is a
    // counterparty, not somebody we place.
    if (b.kind !== "nurse") {
      return NextResponse.json({
        error: "not_a_candidate",
        message: "Only nurse bookings can join the candidate pool.",
      }, { status: 400 });
    }
    if (b.lead_id) {
      leadId = b.lead_id;
    } else {
      if (!looksLikeEmail((b.email ?? "").trim().toLowerCase())) {
        return NextResponse.json({
          error: "no_email",
          message: "This booking has no usable email, so no portal account can be made yet.",
        }, { status: 400 });
      }
      const made = await db.from("leads").insert({
        kind: "nurse",
        email: (b.email ?? "").trim().toLowerCase(),
        name: b.name ?? "",
        phone: (b.phone ?? "") || "",
        message: `Booked a call ${b.starts_at.slice(0, 16).replace("T", " ")}`,
        details: { source: "booking", at: b.starts_at },
      }).select("id").single();
      if (made.error || !made.data) {
        console.error("[lead-to-pool] lead insert from booking failed:", made.error?.message);
        return NextResponse.json({ error: "lead_failed" }, { status: 500 });
      }
      leadId = made.data.id as string;
      await db.from("bookings").update({ lead_id: leadId }).eq("id", b.id);
    }
  }

  if (!UUID_RE.test(leadId)) return NextResponse.json({ error: "bad_lead" }, { status: 400 });

  const { data: lead, error: le } = await db
    .from("leads")
    .select("id,kind,email,name,phone,candidate_user_id,converted_at")
    .eq("id", leadId)
    .maybeSingle();
  if (le || !lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  const row = lead as {
    id: string; kind: string; email: string; name: string; phone: string;
    candidate_user_id: string | null; converted_at: string | null;
  };

  // Already converted → return the existing link rather than making a second
  // account. The button is safe to press twice.
  if (row.candidate_user_id) {
    return NextResponse.json({ ok: true, alreadyConverted: true, userId: row.candidate_user_id, leadId: row.id });
  }

  // Only a NURSE belongs in the candidate pool. This guard existed on the
  // booking path but not here, while the Leads page shows "Add to pool" on
  // every row — so one click on a clinic or a company enquiry would have made a
  // portal account for a hospital and filed it as somebody we are placing.
  if (row.kind !== "nurse") {
    return NextResponse.json({
      error: "not_a_candidate",
      message: "Only nurse enquiries can join the candidate pool — a clinic or a company is a counterparty, not someone we place.",
    }, { status: 400 });
  }

  const email = (row.email ?? "").trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    return NextResponse.json({
      error: "no_email",
      message: "This lead has no usable email, so no portal account can be made for them yet.",
    }, { status: 400 });
  }

  // 1. Reuse the account if they already registered themselves.
  let userId = await findUserByEmail(email);
  let created = false;

  // 2. Otherwise create one — quietly, no invite mail.
  if (!userId) {
    const full = (row.name ?? "").trim();
    const [fn, ...rest] = full.split(/\s+/).filter(Boolean);
    const created_ = await db.auth.admin.createUser({
      email,
      email_confirm: false,          // they still have to verify when they claim it
      user_metadata: {
        first_name: fn || null,
        last_name: rest.join(" ") || null,
        full_name: full || null,
        phone: (row.phone ?? "").trim() || null,
        // Provenance, so it's obvious later that Borivon created this, not them.
        created_from_lead: row.id,
      },
    });
    if (created_.error || !created_.data?.user) {
      console.error("[lead-to-pool] createUser failed:", created_.error?.message);
      return NextResponse.json({ error: "account_failed", message: created_.error?.message ?? "" }, { status: 500 });
    }
    userId = created_.data.user.id;
    created = true;
  }

  // 3. GIVE THEM A PROFILE ROW, or they are invisible.
  //
  //    Every candidate board — the Pool, the Batch Tracker, the admin roster —
  //    builds its list from `candidate_profiles` and then joins the pipeline on
  //    to it (app/api/portal/tracker/route.ts:64). A pipeline row on its own
  //    renders nowhere. So "Add to pool" appeared to work, the lead was marked
  //    converted and vanished from Leads, and the person was in no list at all.
  //    Measured before the fix: three pipeline rows already in exactly that
  //    state, all in the Pool, none of them displayable.
  //
  //    An UPDATE-then-INSERT rather than an upsert: someone who registered on
  //    their own already has a profile they filled in, and their real name must
  //    not be overwritten by whatever was typed into a lead form.
  {
    const { data: prof } = await db
      .from("candidate_profiles").select("user_id").eq("user_id", userId).maybeSingle();
    if (!prof) {
      const full = (row.name ?? "").trim();
      const [fn, ...rest] = full.split(/\s+/).filter(Boolean);
      const seed: Record<string, unknown> = {
        user_id: userId,
        first_name: fn || null,
        last_name: rest.join(" ") || null,
        phone: (row.phone ?? "").trim() || null,
      };
      const made = await db.from("candidate_profiles").insert(seed);
      if (made.error) {
        // Schema-tolerant: if this deployment's profile table lacks `phone`,
        // still create the row — a nameless entry the founder can edit beats a
        // person who exists nowhere.
        const missingCol = /column .* does not exist|schema cache|phone|first_name|last_name/i.test(made.error.message ?? "");
        const retry = missingCol ? await db.from("candidate_profiles").insert({ user_id: userId }) : made;
        if (retry.error) {
          console.error("[lead-to-pool] profile insert failed:", retry.error.message);
          return NextResponse.json({ error: "profile_failed" }, { status: 500 });
        }
      }
    }
  }

  // 4. Put them in the POOL: a pipeline row with NO batch. `pool_contacted` is
  //    true by definition — a lead is somebody who already reached out.
  //
  //    CRUCIALLY, only INSERT a batch_id when there is no row yet. A blind
  //    upsert with batch_id:null would rip an already-placed candidate out of
  //    their batch — and if that same lead email belongs to someone already in
  //    UKSH Kiel, pressing this button would quietly un-place them.
  const { data: existing } = await db
    .from("candidate_pipeline").select("user_id,batch_id").eq("user_id", userId).maybeSingle();

  const touch = { pool_contacted: true, last_touch_at: new Date().toISOString() };
  const write = existing
    ? db.from("candidate_pipeline").update(touch).eq("user_id", userId)   // batch untouched
    : db.from("candidate_pipeline").insert({ user_id: userId, batch_id: null, ...touch });

  const pipe = await write;
  if (pipe.error) {
    // Schema-tolerant: a deployment without the talent_pool migration still gets
    // the person into the pipeline, just without the pool flags.
    if (/pool_contacted|last_touch_at|column .* does not exist|schema cache/i.test(pipe.error.message ?? "")) {
      if (!existing) {
        const retry = await db.from("candidate_pipeline").insert({ user_id: userId, batch_id: null });
        if (retry.error) {
          console.error("[lead-to-pool] pipeline insert failed:", retry.error.message);
          return NextResponse.json({ error: "pool_failed" }, { status: 500 });
        }
      }
      // An existing row with no pool columns needs nothing — they're already tracked.
    } else {
      console.error("[lead-to-pool] pipeline write failed:", pipe.error.message);
      return NextResponse.json({ error: "pool_failed" }, { status: 500 });
    }
  }
  const alreadyPlaced = !!existing?.batch_id;

  // 4. Mark the lead converted so it stops looking like untouched work.
  const mark = await db.from("leads")
    .update({ candidate_user_id: userId, converted_at: new Date().toISOString(), status: "converted" })
    .eq("id", row.id);
  if (mark.error) {
    // The person IS in the pool, which is what matters — don't fail the call
    // over the bookkeeping, but say so loudly.
    console.error("[lead-to-pool] lead mark failed:", mark.error.message);
  }

  return NextResponse.json({ ok: true, userId, createdAccount: created, alreadyPlaced });
}
