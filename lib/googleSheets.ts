/**
 * Google Sheets — the live ONE-WAY candidate mirror (SERVER ONLY).
 *
 * The portal + Telegram bot push the whole candidate base into ONE Google Sheet
 * the founder owns, so he has a single filterable surface fed from everywhere.
 * It is deliberately one-way: this writer only ever touches its OWN columns
 * (A..N) — any columns the founder adds to the RIGHT survive every sync, and
 * editing the sheet never writes back into the portal (no corruption risk).
 *
 * Row order is STABLE (oldest registration first) so new signups append at the
 * bottom and the founder's side-column annotations stay aligned with their rows.
 * (Caveat: permanently deleting a candidate shifts rows below it up by one.)
 *
 * Reuses the existing domain-wide-delegation service account via sheetsClient()
 * — the same one the bot's Gmail/Calendar already use — so no new Google setup.
 * Fails safe: returns a typed error if Workspace isn't connected or the
 * app_settings table hasn't been migrated yet; nothing throws.
 *
 * NOTE (Cloudflare): sheetsClient() builds a real googleapis JWT client, which
 * runs on Vercel (Node) but not yet on Workers (only Gmail/Calendar have REST
 * shims). The bot runs on Vercel today; a Sheets shim is a later cutover task.
 */
import { sheetsClient } from "@/lib/googleWorkspace";
import type { SupabaseClient } from "@supabase/supabase-js";

const SHEET_KEY = "candidates_sheet_id";
const TAB = "Candidates";

type DB = SupabaseClient;

/** 1 → "A", 11 → "K", 27 → "AA". Enough for our column counts. */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s || "A";
}

export type SheetSyncResult =
  | { ok: true; url: string; count: number; created: boolean }
  | { ok: false; error: "workspace_not_connected" | "settings_not_set_up" | "sync_failed"; hint?: string };

/**
 * Push `rows` (each a full row of string cells, aligned to `headers`) into the
 * founder's candidate sheet. Creates the sheet on first call and remembers it in
 * app_settings; reuses it thereafter. Clears only the managed columns before
 * writing so the founder's own columns to the right are preserved.
 */
export async function syncCandidateSheet(db: DB, headers: string[], rows: string[][]): Promise<SheetSyncResult> {
  const sheets = sheetsClient();
  if (!sheets) return { ok: false, error: "workspace_not_connected", hint: "Connect Google Workspace (domain-wide delegation) first — the same one Gmail uses." };

  // Resolve the spreadsheet id (persisted). A missing table = migration not run.
  let spreadsheetId: string | null = null;
  const { data: setRow, error: setErr } = await db.from("app_settings").select("value").eq("key", SHEET_KEY).maybeSingle();
  if (setErr && (setErr.code === "42P01" || /does not exist|schema cache/i.test(setErr.message ?? ""))) {
    return { ok: false, error: "settings_not_set_up", hint: "Run supabase/app_settings.sql in the Supabase SQL editor first." };
  }
  spreadsheetId = (setRow as { value: string } | null)?.value ?? null;

  // If we have an id but it's gone/inaccessible, drop it so we recreate.
  if (spreadsheetId) {
    try { await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" }); }
    catch { spreadsheetId = null; }
  }

  let created = false;
  try {
    if (!spreadsheetId) {
      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: "Borivon — Candidates" },
          sheets: [{ properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } }],
        },
        fields: "spreadsheetId",
      });
      spreadsheetId = createRes.data.spreadsheetId ?? null;
      if (!spreadsheetId) return { ok: false, error: "sync_failed", hint: "Google did not return a spreadsheet id." };
      created = true;
      await db.from("app_settings").upsert({ key: SHEET_KEY, value: spreadsheetId, updated_at: new Date().toISOString() });
    }

    // Clear ONLY the managed columns (A..last), then write headers + data. The
    // founder's own columns further right are never touched.
    const lastCol = colLetter(headers.length);
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${TAB}!A:${lastCol}` });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers, ...rows] },
    });

    return { ok: true, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, count: rows.length, created };
  } catch {
    return { ok: false, error: "sync_failed", hint: "Could not write to the Google Sheet — check the Workspace delegation includes the spreadsheets scope." };
  }
}
