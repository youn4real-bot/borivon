import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  // ── Auth: verify JWT matches the requested uid ────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ pipeline: null }, { status: 401 });
  }
  const jwt = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) {
    return NextResponse.json({ pipeline: null }, { status: 401 });
  }

  // Use verified user.id — ignore any uid param from client
  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_pipeline")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ pipeline: data ?? null });
}
