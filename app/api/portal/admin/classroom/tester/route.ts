import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
import { isPermanentTester } from "@/lib/classroomTesters";

/**
 * SUPREME-ADMIN-ONLY: flip a candidate's private-test allowlist flag for the
 * live classroom. While the classroom is in private testing, only candidates
 * with classroom_tester=true (plus the admin host) can see or join it.
 *
 * GET  ?userId= → { tester }
 * PATCH { candidateUserId, enabled } → { tester }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "bad userId" }, { status: 400 });

  const permanent = isPermanentTester(userId);
  const db = getServiceSupabase();
  const { data } = await db.from("candidate_profiles").select("classroom_tester").eq("user_id", userId).maybeSingle();
  const col = (data as { classroom_tester?: boolean } | null)?.classroom_tester === true;
  return NextResponse.json({ tester: permanent || col, permanent });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { candidateUserId?: unknown; enabled?: unknown };
  const userId = typeof body.candidateUserId === "string" ? body.candidateUserId : "";
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "bad candidateUserId" }, { status: 400 });
  const enabled = body.enabled === true;

  // The permanent pair can never be turned off — it's the standing test combo.
  if (isPermanentTester(userId)) return NextResponse.json({ tester: true, permanent: true });

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update({ classroom_tester: enabled }).eq("user_id", userId);
  if (error) { console.error("[classroom/tester] update error:", error.message); return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
  return NextResponse.json({ tester: enabled });
}
