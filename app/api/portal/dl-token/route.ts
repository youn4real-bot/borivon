import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { signDlToken } from "@/lib/dlToken";

/**
 * Mint a short-lived (3 min) signed DOWNLOAD token.
 *
 * The caller proves identity with the normal Authorization: Bearer <JWT>
 * header (a fetch, not a navigation — so the JWT never enters a URL). The
 * returned token is then safe to put in an iOS file-route URL: it expires
 * in minutes and authorizes nothing but a re-proof of "this is user X" to
 * the file/PDF routes (which still run their own ownership checks).
 *
 * requireUser already rejects soft-deleted/banned accounts, so a deleted
 * user can't mint one.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let token: string;
  try {
    token = signDlToken(auth.userId, 180);
  } catch {
    // No signing secret configured — fail loudly rather than silently
    // handing back something unusable.
    return NextResponse.json({ error: "Download tokens unavailable" }, { status: 500 });
  }

  return NextResponse.json(
    { token, expiresInSec: 180 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
