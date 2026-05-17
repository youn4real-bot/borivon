import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ count: 0 });

  const db = getServiceSupabase();

  // Permanent server-side "last seen" — survives logout/login + syncs
  // across devices. Use the most recent of: server seen_at, the client's
  // localStorage hint, and epoch. The server value is authoritative, so a
  // badge cleared on one device never reappears on another.
  const clientSince = req.nextUrl.searchParams.get("since") ?? "";
  const { data: seenRow } = await db
    .from("community_seen")
    .select("seen_at")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const serverSeen = (seenRow as { seen_at?: string } | null)?.seen_at ?? "";

  const candidates = [serverSeen, clientSince].filter(Boolean);
  // Nothing recorded anywhere → first-ever visit: baseline NOW so we don't
  // flood the badge with the whole feed history.
  const since = candidates.length
    ? candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : new Date().toISOString();

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
