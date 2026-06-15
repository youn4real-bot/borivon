/**
 * Stream a Gmail ATTACHMENT to the bot so it can deliver the file in chat.
 *
 * The assistant's getEmailAttachments tool mints a short-lived download token
 * (signDlToken, ~3 min) and hands back URLs pointing here; the Telegram webhook
 * fetches each URL and forwards the bytes as a document. Auth is the dl-token
 * ONLY (the webhook can't attach a JWT) — and it is gated STRICTLY to the supreme
 * admin: a candidate's own (valid) download token must never reach the founder's
 * private mail, so we compare the token's user to ADMIN's auth id.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyDlToken, DL_TOKEN_PARAM } from "@/lib/dlToken";
import { getAdminUserId } from "@/lib/telegram";
import { getEmailAttachmentBytes } from "@/lib/gmailApi";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const tok = verifyDlToken(req.nextUrl.searchParams.get(DL_TOKEN_PARAM));
  if (!tok) return new NextResponse("unauthorized", { status: 401 });
  const adminId = await getAdminUserId();
  if (!adminId || tok.userId !== adminId) return new NextResponse("forbidden", { status: 403 });

  const mid = req.nextUrl.searchParams.get("mid");
  const aid = req.nextUrl.searchParams.get("aid");
  if (!mid || !aid) return new NextResponse("bad_request", { status: 400 });
  const name = (req.nextUrl.searchParams.get("name") || "attachment").replace(/[^\w.\-() ]+/g, "_").slice(0, 200) || "attachment";

  const bytes = await getEmailAttachmentBytes(mid, aid);
  if (!bytes) return new NextResponse("not_found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
