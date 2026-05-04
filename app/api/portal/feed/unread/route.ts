import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ count: 0 });

  const since = req.nextUrl.searchParams.get("since") ?? "";
  if (!since) return NextResponse.json({ count: 0 });

  const db = getServiceSupabase();

  const [{ count: posts }, { count: comments }] = await Promise.all([
    db.from("feed_posts")
      .select("id", { count: "exact", head: true })
      .neq("user_id", auth.userId)
      .gt("created_at", since),
    db.from("feed_comments")
      .select("id", { count: "exact", head: true })
      .neq("user_id", auth.userId)
      .gt("created_at", since),
  ]);

  return NextResponse.json({ count: (posts ?? 0) + (comments ?? 0) });
}
