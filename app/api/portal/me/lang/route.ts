import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * Remember which language this candidate reads.
 *
 * The portal already knows — she picked it in the language switcher, and every
 * page renders in it. What was missing was anywhere to KEEP it, so the one email
 * telling her a document blocking her job application was refused went out in
 * all three languages stacked together.
 *
 * The dashboard PUTs here once, only when the stored value differs from the one
 * she is actually reading the page in. So it costs nothing on a normal load and
 * self-heals for every existing candidate the next time she opens the portal —
 * no backfill, no migration guesswork, no asking her a question she has already
 * answered by using the site.
 *
 * SELF ONLY. Takes the user id from the verified JWT and never from the body, so
 * this cannot be used to set anybody else's language.
 *
 * Schema-tolerant: before supabase/candidate_lang.sql is run the write fails and
 * we answer 200 { stored: false }. A missing column must not make her dashboard
 * look broken over a preference.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANGS = new Set(["fr", "en", "de"]);
const MIGRATION_RE = /lang|column .* does not exist|schema cache/i;

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const lang = typeof body?.lang === "string" ? body.lang.trim().toLowerCase() : "";
  // Whitelisted, so the column's CHECK constraint can never be the thing that
  // rejects a write we should have caught here.
  if (!LANGS.has(lang)) return NextResponse.json({ error: "bad_lang" }, { status: 400 });

  const { error } = await getServiceSupabase()
    .from("candidate_profiles")
    .upsert({ user_id: auth.userId, lang }, { onConflict: "user_id" });

  if (error) {
    if (MIGRATION_RE.test(error.message ?? "")) {
      console.warn("[me/lang] `lang` column missing — run supabase/candidate_lang.sql");
      return NextResponse.json({ ok: true, stored: false });
    }
    console.error("[me/lang] write failed:", error.message);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stored: true });
}
