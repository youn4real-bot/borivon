import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";
import { computeDueReminders, isDocRemindersOn, setDocReminders } from "@/lib/docRemindersRun";
import { reminderLabel } from "@/lib/docReminders";

/**
 * GET  /api/portal/admin/doc-reminders?lang=de
 *   → { enabled, tableReady, canToggle, sentLast7d, due: [{ userId, name, items: [{ kind, label }] }] }
 *   Who the next daily run would email, and with what. Scoped per LAW #25.
 *
 * POST { enabled: boolean } — supreme admin only. Turning it ON is refused
 *   until the reminder log table exists (without it the job cannot know who it
 *   already wrote to).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = req.nextUrl.searchParams.get("lang");
  const lang = q === "de" || q === "en" || q === "fr" ? q : "de";

  const [enabled, c] = await Promise.all([isDocRemindersOn(), computeDueReminders()]);
  let due = c.due;
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);
  if (visible !== null) {
    const allow = new Set(visible);
    due = due.filter((d) => allow.has(d.userId));
  }

  return NextResponse.json({
    enabled,
    tableReady: c.tableReady,
    canToggle: auth.role === "admin",
    sentLast7d: auth.role === "admin" ? c.sentLast7d : undefined,
    due: due.map((d) => ({
      userId: d.userId,
      name: d.name,
      items: d.items.map((i) => ({ kind: i.kind, label: reminderLabel(i.key, lang, c.slotLabels) })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });

  if (body.enabled) {
    const c = await computeDueReminders();
    if (!c.tableReady) return NextResponse.json({ error: "setup_required" }, { status: 409 });
  }
  if (!(await setDocReminders(body.enabled))) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ enabled: body.enabled });
}
