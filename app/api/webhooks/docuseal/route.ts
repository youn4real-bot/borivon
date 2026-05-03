import { NextResponse } from "next/server";

// DocuSeal integration replaced by built-in signature pad.
// Route kept to avoid 404s if any lingering webhook pings arrive.
export async function POST() {
  return NextResponse.json({ ok: true });
}
