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
 * runs on Node but NOT on Workers — only Gmail, Calendar and Drive have REST
 * shims. The whole app, bot included, now runs on Workers, so sheetsClient()
 * deliberately returns null there and every function below refuses with a
 * hint that says exactly that. Writing a Sheets shim is the outstanding work;
 * until it exists, failing clearly beats crashing inside google-auth-library.
 */
import { sheetsClient, driveClient, sheetsShimMissing } from "@/lib/googleWorkspace";
import type { SupabaseClient } from "@supabase/supabase-js";

const SHEET_KEY = "candidates_sheet_id";
const TAB = "Candidates";

// The maximal Borivon tracking column set appended to the copied sheet — the
// founder prunes what he doesn't want. "Every column possible" (his words).
const UPGRADE_HEADERS = [
  "Registered", "Name", "Email", "Phone / WhatsApp", "City of residence", "Country",
  "Date of birth", "Sex", "Nationality", "Marital status", "Children",
  "Agency", "Employer", "Batch", "Funnel stage",
  "Screening call", "Interview 1 date", "Interview 1 result", "Interview 2 date", "Interview 2 result",
  "Agreement signed", "Agreement received (mailed)",
  "B2 stage", "B2 exam date", "B2 passed", "B2 failed once",
  "Vaccines — Masern", "Vaccines — Varizellen", "Vaccines complete",
  "Workplace (Altenheim/Klinik)", "Specialty", "Years experience", "Current workplace", "Available from",
  "Anerkennung stage", "Vorabzustimmung", "Recognition done",
  "Passport number", "Passport expiry", "Passport status",
  "Contract signed", "Visa appointment", "Visa granted", "Visa date", "Flight date", "Arrived", "Housing done", "Employment start",
  "Docs approved/total", "CV done", "Latest note", "Candidate ID", "Portal link",
];

// Canonical GERMAN header per known variant. The sheet's header block often
// stacks English + German ("first" above "vorname") — we collapse to ONE fixed
// German title. Anything unknown keeps its own text (we never invent a label).
const CANON: { de: string; match: RegExp }[] = [
  { de: "Vorname", match: /^(first( ?name)?|prenom|prénom|vorname)$/i },
  { de: "Nachname", match: /^(last( ?name)?|surname|family ?name|nom|nachname|familienname)$/i },
  { de: "Name", match: /^(full ?name|name|nom complet)$/i },
  { de: "E-Mail", match: /^(e-?mail|mail|courriel)$/i },
  { de: "Telefon", match: /^(phone|tel(ephone)?|mobile|whatsapp|telefon|handy)$/i },
  { de: "Geburtsdatum", match: /^(dob|date of birth|birth ?date|birthday|naissance|geburtsdatum|geburtstag)$/i },
  { de: "Geschlecht", match: /^(sex|gender|geschlecht)$/i },
  { de: "Nationalität", match: /^(nationality|nationalite|nationalité|nationalitat|nationalität|staatsangehörigkeit)$/i },
  { de: "Adresse", match: /^(address|adresse)$/i },
  { de: "Stadt", match: /^(city|ville|stadt|wohnort)$/i },
  { de: "Land", match: /^(country|pays|land)$/i },
  { de: "Reisepass", match: /^(passport( ?(no|number))?|passeport|reisepass|pass(nummer)?)$/i },
  { de: "Reisepass gültig bis", match: /^(passport expiry|expiry|ablauf|gültig bis)$/i },
  { de: "Deutsch (B2)", match: /^(b2|german|deutsch|sprache|language|niveau)$/i },
  { de: "Prüfungstermin", match: /^(exam( date)?|prüfung(stermin)?|examen)$/i },
  { de: "Impfung", match: /^(vaccine|vaccination|impfung|impfstatus)$/i },
  { de: "Fachrichtung", match: /^(specialty|speciality|spezialisierung|fachrichtung)$/i },
  { de: "Berufserfahrung", match: /^(experience|years( of)? experience|erfahrung|berufserfahrung)$/i },
  { de: "Anerkennung", match: /^(recognition|anerkennung)$/i },
  { de: "Vertrag", match: /^(contract|vertrag)$/i },
  { de: "Visum", match: /^(visa|visum)$/i },
  { de: "Flug", match: /^(flight|flug)$/i },
  { de: "Status", match: /^(status|stand)$/i },
  { de: "Bemerkung", match: /^(notes?|comment(s)?|remark|bemerkung|kommentar|notiz)$/i },
];
const canonical = (labels: string[]): string => {
  for (const l of labels) { const hit = CANON.find((c) => c.match.test(l.trim())); if (hit) return hit.de; }
  return labels.length ? labels[labels.length - 1].trim() : ""; // else the LAST label (the German one sits below)
};
// A row "looks like data" if it carries an email / phone / date / long number.
const looksLikeData = (row: string[]): boolean =>
  row.filter((c) => /@|^\+?\d[\d\s()-]{5,}$|^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(String(c ?? "").trim())).length >= 1;

export type SheetCleanResult =
  | { ok: true; url: string; headerRowsFound: number; before: string[][]; after: string[]; deletedColumns: string[]; deletedHeaderRows: number }
  | { ok: false; error: "workspace_not_connected" | "bad_url" | "no_access" | "failed"; hint?: string };

/**
 * CLEAN a sheet's header, fully programmatically: detect the stacked header
 * block (e.g. "first" over "vorname"), collapse it into ONE fixed German title
 * row, delete the now-redundant header rows, drop EMPTY duplicate columns, and
 * freeze the header. Never touches data rows or colors.
 */
export async function cleanSheetHeaders(sourceUrl: string): Promise<SheetCleanResult> {
  const sheets = sheetsClient();
  if (!sheets) return { ok: false, error: "workspace_not_connected", hint: sheetsShimMissing() ? "Google Sheets isn't wired up on the Cloudflare deployment yet (Gmail, Calendar and Drive are). Nothing is broken — this one feature is still to be ported." : "Google Workspace isn't connected." };
  const m = sourceUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || sourceUrl.match(/^([a-zA-Z0-9_-]{25,})$/);
  const id = m?.[1];
  if (!id) return { ok: false, error: "bad_url", hint: "Send the full Google Sheet URL." };

  try {
    // Main tab = the one with the widest header.
    const ss = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(sheetId,title))" });
    let target = ss.data.sheets?.[0]?.properties, widest = -1;
    for (const s of ss.data.sheets ?? []) {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${s.properties?.title}'!1:1` });
      const n = (r.data.values?.[0] ?? []).filter((v) => String(v).trim() !== "").length;
      if (n > widest) { widest = n; target = s.properties; }
    }
    const tab = target?.title as string;
    const sheetId = target?.sheetId ?? 0;

    // Read the top block + enough rows to judge which columns are empty.
    const grid = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A1:BZ300` });
    const rows: string[][] = (grid.data.values ?? []).map((r) => (r as unknown[]).map((c) => String(c ?? "")));
    if (!rows.length) return { ok: false, error: "failed", hint: "That tab looks empty." };

    // Header block = the rows above the first data-looking row (cap 6).
    let dataStart = rows.findIndex((r, i) => i > 0 && looksLikeData(r));
    if (dataStart < 1) dataStart = 1;           // no detectable data → treat row 1 as the only header
    if (dataStart > 6) dataStart = 6;
    const headerBlock = rows.slice(0, dataStart);
    const width = Math.max(...headerBlock.map((r) => r.length), 0);

    // One canonical German title per column.
    const after: string[] = [];
    for (let c = 0; c < width; c++) {
      const labels = headerBlock.map((r) => (r[c] ?? "").trim()).filter((v) => v !== "");
      after.push(canonical(labels));
    }

    // Empty duplicate columns → delete (keeps the first occurrence).
    const body = rows.slice(dataStart);
    const isEmptyCol = (c: number) => body.every((r) => String(r[c] ?? "").trim() === "");
    const seen = new Set<string>();
    const dropIdx: number[] = [];
    const deletedColumns: string[] = [];
    after.forEach((h, c) => {
      const k = h.toLowerCase();
      if (!k) return;
      if (seen.has(k) && isEmptyCol(c)) { dropIdx.push(c); deletedColumns.push(h); }
      else seen.add(k);
    });

    // 1) write the single canonical header row
    await sheets.spreadsheets.values.update({
      spreadsheetId: id, range: `'${tab}'!A1`, valueInputOption: "RAW", requestBody: { values: [after] },
    });

    // 2) delete the redundant header rows, the duplicate columns, then freeze+bold
    const requests: object[] = [];
    if (dataStart > 1) requests.push({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: dataStart } } });
    for (const c of [...dropIdx].sort((a, b) => b - a)) {
      requests.push({ deleteDimension: { range: { sheetId, dimension: "COLUMNS", startIndex: c, endIndex: c + 1 } } });
    }
    requests.push(
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.verticalAlignment" } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: Math.max(1, width) } } },
    );
    if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });

    return {
      ok: true, url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
      headerRowsFound: dataStart, before: headerBlock, after: after.filter((_, c) => !dropIdx.includes(c)),
      deletedColumns, deletedHeaderRows: Math.max(0, dataStart - 1),
    };
  } catch (e) {
    return { ok: false, error: "failed", hint: e instanceof Error ? e.message : String(e) };
  }
}

export type SheetUpgradeResult =
  | { ok: true; url: string; existingColumns: number; addedColumns: number; title: string }
  | { ok: false; error: "workspace_not_connected" | "bad_url" | "no_access" | "failed"; hint?: string };

/**
 * Make a CLEAN, upgraded COPY of an existing Google Sheet the founder points at:
 * copies it into his Drive (keeps ALL his data + colors), makes the header
 * presentable (freeze row 1 + basic filter + auto-resize), and APPENDS the full
 * Borivon tracking column set to the RIGHT (headers only — he prunes later, then
 * we auto-fill the kept ones). Access check is the first step: if the sheet isn't
 * reachable by the impersonated Workspace user, it returns no_access with the fix.
 */
export async function copyAndUpgradeSheet(sourceUrl: string): Promise<SheetUpgradeResult> {
  const sheets = sheetsClient();
  const drive = driveClient();
  if (!sheets || !drive) return { ok: false, error: "workspace_not_connected", hint: sheetsShimMissing() ? "Google Sheets isn't wired up on the Cloudflare deployment yet (Gmail, Calendar and Drive are). Nothing is broken — this one feature is still to be ported." : "Google Workspace isn't connected." };
  const m = sourceUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || sourceUrl.match(/^([a-zA-Z0-9_-]{25,})$/);
  const sourceId = m?.[1];
  if (!sourceId) return { ok: false, error: "bad_url", hint: "Send the full Google Sheet URL." };

  // 1) ACCESS CHECK — can the impersonated Workspace user open it?
  let title = "Sheet";
  try {
    const meta = await drive.files.get({ fileId: sourceId, fields: "id,name", supportsAllDrives: true });
    title = meta.data.name ?? "Sheet";
  } catch {
    return { ok: false, error: "no_access", hint: "Can't open that sheet with the Workspace account. Share it with youness.taoufiq@borivon.com (Editor), then try again." };
  }

  try {
    // 2) Copy into the founder's Drive (data + colors preserved).
    const copy = await drive.files.copy({ fileId: sourceId, requestBody: { name: `${title} — Borivon (upgraded)` }, fields: "id", supportsAllDrives: true });
    const newId = copy.data.id as string;

    // 3) First tab + how many columns his data already uses.
    const ss = await sheets.spreadsheets.get({ spreadsheetId: newId, fields: "sheets(properties(sheetId,title))" });
    const first = ss.data.sheets?.[0]?.properties;
    const sheetId = first?.sheetId ?? 0;
    const tab = first?.title ?? "Sheet1";
    const headerRow = await sheets.spreadsheets.values.get({ spreadsheetId: newId, range: `${tab}!1:1` });
    const existingCols = headerRow.data.values?.[0]?.length ?? 0;

    // 4) Append the full Borivon column menu to the RIGHT of his data.
    await sheets.spreadsheets.values.update({
      spreadsheetId: newId,
      range: `${tab}!${colLetter(existingCols + 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [UPGRADE_HEADERS] },
    });

    // 5) Make it presentable — freeze the header, add a filter, auto-size columns,
    //    and bold ONLY the new headers (his colors/data are never touched).
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: newId,
      requestBody: {
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          { setBasicFilter: { filter: { range: { sheetId } } } },
          { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: existingCols + UPGRADE_HEADERS.length } } },
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: existingCols, endColumnIndex: existingCols + UPGRADE_HEADERS.length }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
        ],
      },
    });

    return { ok: true, url: `https://docs.google.com/spreadsheets/d/${newId}/edit`, existingColumns: existingCols, addedColumns: UPGRADE_HEADERS.length, title };
  } catch (e) {
    return { ok: false, error: "failed", hint: e instanceof Error ? e.message : String(e) };
  }
}

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
  if (!sheets) return { ok: false, error: "workspace_not_connected", hint: sheetsShimMissing() ? "Google Sheets isn't wired up on the Cloudflare deployment yet (Gmail, Calendar and Drive are). Nothing is broken — this one feature is still to be ported." : "Connect Google Workspace (domain-wide delegation) first — the same one Gmail uses." };

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
