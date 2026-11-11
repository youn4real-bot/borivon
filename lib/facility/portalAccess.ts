/**
 * Whose journey a portal request is about: a nurse only ever reaches her own; an admin (supreme, the
 * Borivon team, or her DIY facility) only a nurse canActOnCandidate allows (LAW #25 incl. the DIY rule).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, requireUser, canActOnCandidate } from "@/lib/admin-auth";

export type Who = { userId: string; by: string; admin: boolean };
const UUID = /^[0-9a-f-]{36}$/i;
export const askedId = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

export async function journeyOwner(req: NextRequest, asked: string | null): Promise<Who | NextResponse> {
  const admin = await requireAdminRole(req);
  if (admin.ok && asked) {
    if (!(await canActOnCandidate(admin.role, admin.email, asked))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return { userId: asked, by: admin.email, admin: true };
  }
  const user = await requireUser(req);
  if (!user.ok) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  return { userId: user.userId, by: user.email, admin: false };
}
