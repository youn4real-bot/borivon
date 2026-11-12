/**
 * Extra papers for ONE nurse (fx_extra_docs) and the papers filter that stays (fx_docview).
 * Founder 2026-11-12: one general list of papers for every nurse; when an agency or employer wants more,
 * her admins add (and remove) extra papers for her alone — the general list is never touched.
 * An extra's id is a UUID and doubles as the upload file key (stored as documents.file_type), exactly
 * like a phase slot, so the upload / preview / review paths need nothing new.
 */
import { fxDb } from "@/lib/facility/db";

export type ExtraDoc = { id: string; label: string; phase: "A" | "V" };
export type DocView = "all" | "A" | "V";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const cleanLabel = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, 80);
  return s.length >= 2 ? s : null;
};
export const cleanPhase = (v: unknown): "A" | "V" => (v === "V" ? "V" : "A");
export const cleanView = (v: unknown): DocView | null => (v === "all" || v === "A" || v === "V" ? v : null);

export async function listExtras(userId: string): Promise<ExtraDoc[]> {
  const db = await fxDb();
  if (!db) return [];
  const { results } = await db.run(`SELECT id, label, phase FROM fx_extra_docs WHERE user_id = ? ORDER BY created_at`, [userId]);
  return (results as { id: string; label: string; phase: string }[]).map((r) => ({ id: r.id, label: r.label, phase: cleanPhase(r.phase) }));
}

/** The label of an extra paper, for upload file names and the admin bell; null if `id` is not one. */
export async function extraDocLabel(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  try {
    const db = await fxDb();
    if (!db) return null;
    const { results } = await db.run(`SELECT label FROM fx_extra_docs WHERE id = ?`, [id]);
    return ((results[0] as { label?: string } | undefined)?.label) ?? null;
  } catch {
    return null; // a name is cosmetic here — never fail an upload over it
  }
}

export const viewKey = (userId: string, admin: boolean) => `${userId}:${admin ? "admin" : "self"}`;
