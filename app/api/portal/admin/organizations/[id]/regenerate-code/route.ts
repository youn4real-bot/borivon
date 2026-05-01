import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Generates a random 8-char code using unambiguous characters (no 0/O/1/I). */
function generateCode(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * POST /api/portal/admin/organizations/[id]/regenerate-code
 *
 * Generates a new unique invite code for the given organization.
 * The old code stops working immediately. Existing candidate/member links
 * are unaffected — only future joins require the new code.
 *
 * 200 { success: true, invite_code: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid org id" }, { status: 400 });

  const db = getServiceSupabase();

  // Retry up to 5 times in case of unique-constraint collision (extremely rare).
  for (let attempt = 0; attempt < 5; attempt++) {
    const newCode = generateCode();
    const { error } = await db
      .from("organizations")
      .update({ invite_code: newCode })
      .eq("id", id);

    if (!error) {
      return NextResponse.json({ success: true, invite_code: newCode });
    }

    // If it is NOT a uniqueness error, bail immediately.
    const msg = (error.message ?? "").toLowerCase();
    if (!msg.includes("unique") && !msg.includes("duplicate")) {
      console.error("[regenerate-code] update failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    // Unique collision — loop and try a fresh code.
  }

  return NextResponse.json(
    { error: "Could not generate a unique code — please try again." },
    { status: 500 },
  );
}
