import React from "react";
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { google } from "googleapis";
import { PassThrough } from "stream";

// ── Country / nationality helpers ─────────────────────────────────────────────
const NAT_MAP: Record<string, string> = {
  MAR: "Marokko",   DZA: "Algerien",  TUN: "Tunesien",  EGY: "Ägypten",
  LBY: "Libyen",    SYR: "Syrien",    LBN: "Libanon",   JOR: "Jordanien",
  FRA: "Frankreich",DEU: "Deutschland",ESP: "Spanien",   ITA: "Italien",
  GBR: "Vereinigtes Königreich", TUR: "Türkei",
  SEN: "Senegal",   NGA: "Nigeria",   GHA: "Ghana",     MLI: "Mali",
  PSE: "Palästina", IRQ: "Irak",      IRN: "Iran",      PAK: "Pakistan",
  IND: "Indien",    PHL: "Philippinen",MRT: "Mauretanien",
};

const NAT_ADJ: Record<string, string> = {
  MAR: "marokkanisch",  DZA: "algerisch",    TUN: "tunesisch",
  EGY: "ägyptisch",    LBY: "libysisch",    SYR: "syrisch",
  LBN: "libanesisch",  JOR: "jordanisch",   FRA: "französisch",
  DEU: "deutsch",      ESP: "spanisch",     ITA: "italienisch",
  GBR: "britisch",     TUR: "türkisch",     SEN: "senegalesisch",
  NGA: "nigerianisch", GHA: "ghanaisch",    MLI: "malisch",
  PSE: "palästinensisch",IRQ: "irakisch",   IRN: "iranisch",
  PAK: "pakistanisch", IND: "indisch",      PHL: "philippinisch",
  MRT: "mauretanisch",
};

// Reverse lookup: display name → ISO code
const DISPLAY_TO_ISO: Record<string, string> = {};
for (const [iso, de] of Object.entries(NAT_MAP)) DISPLAY_TO_ISO[de.toUpperCase()] = iso;
for (const [iso, adj] of Object.entries(NAT_ADJ)) DISPLAY_TO_ISO[adj.toUpperCase()] = iso;
// Also add common English/French display names
const EXTRA_DISPLAY: Record<string, string> = {
  MOROCCO: "MAR", ALGERIA: "DZA", TUNISIA: "TUN", EGYPT: "EGY", LIBYA: "LBY",
  SYRIA: "SYR", LEBANON: "LBN", JORDAN: "JOR", FRANCE: "FRA", GERMANY: "DEU",
  SPAIN: "ESP", ITALY: "ITA", "UNITED KINGDOM": "GBR", TURKEY: "TUR",
  SENEGAL: "SEN", NIGERIA: "NGA", GHANA: "GHA", MALI: "MLI",
  PALESTINE: "PSE", IRAQ: "IRQ", IRAN: "IRN", PAKISTAN: "PAK",
  INDIA: "IND", PHILIPPINES: "PHL", MAURITANIA: "MRT",
  MAROC: "MAR", ALGÉRIE: "DZA", TUNISIE: "TUN", ÉGYPTE: "EGY", LIBYE: "LBY",
  SYRIE: "SYR", LIBAN: "LBN", JORDANIE: "JOR", ALLEMAGNE: "DEU", ESPAGNE: "ESP",
  ITALIE: "ITA", "ROYAUME-UNI": "GBR", TURQUIE: "TUR", INDE: "IND",
  MAURITANIE: "MRT", PALESTINE2: "PSE", IRAK: "IRQ",
};
for (const [k, v] of Object.entries(EXTRA_DISPLAY)) DISPLAY_TO_ISO[k] = v;

/** Normalize stored nationality/country value → ISO code */
export function toIsoCode(v: string | null | undefined): string {
  if (!v) return "";
  const up = v.trim().toUpperCase();
  if (NAT_MAP[up]) return up; // already ISO
  return DISPLAY_TO_ISO[up] ?? "";
}

function natAdjDe(v: string | null | undefined): string {
  if (!v) return "—";
  const iso = toIsoCode(v) || v.trim().toUpperCase();
  return (NAT_ADJ[iso] ?? NAT_MAP[iso] ?? v).toUpperCase();
}

function countryDe(v: string | null | undefined): string {
  if (!v) return "—";
  const iso = toIsoCode(v) || v.trim().toUpperCase();
  return (NAT_MAP[iso] ?? v).toUpperCase();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function up(s: string | null | undefined): string {
  if (!s) return "—";
  return s.toUpperCase();
}

// ── PDF layout ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generatePassportPdf(profile: any): Promise<Buffer> {
  const styles = StyleSheet.create({
    page:         { fontFamily: "Helvetica", fontSize: 10, color: "#1a1a1a", padding: 48 },
    header:       { marginBottom: 28 },
    title:        { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#0a0a0a", marginBottom: 4 },
    subtitle:     { fontSize: 8, color: "#888" },
    section:      { marginBottom: 20 },
    sectionTitle: {
      fontSize: 7, fontFamily: "Helvetica-Bold", color: "#888",
      textTransform: "uppercase", letterSpacing: 1.2,
      marginBottom: 8, paddingBottom: 5,
      borderBottomWidth: 0.5, borderBottomColor: "#e0e0e0",
    },
    row:    { flexDirection: "row", marginBottom: 7 },
    label:  { fontSize: 8, color: "#666", width: 150 },
    value:  { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1a1a1a", flex: 1 },
    warn:   { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#c0392b", flex: 1 },
    footer: {
      position: "absolute", bottom: 28, left: 48, right: 48,
      fontSize: 7, color: "#bbb", textAlign: "center",
      borderTopWidth: 0.5, borderTopColor: "#eee", paddingTop: 6,
    },
  });

  const firstName  = up(profile.first_name);
  const lastName   = up(profile.last_name);
  const sexLabel   = profile.sex === "M" ? "MÄNNLICH" : profile.sex === "F" ? "WEIBLICH" : "—";
  const expired    = profile.passport_expiry && new Date(profile.passport_expiry) < new Date();
  const expiryStr  = fmtDate(profile.passport_expiry) + (expired ? "  ⚠ ABGELAUFEN" : "");

  const today    = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const fullName = [firstName, lastName].filter(v => v !== "—").join(" ") || "—";

  const groups = [
    {
      title: "Persönliche Daten",
      rows: [
        { label: "Nachname",           value: lastName,                           warn: false },
        { label: "Vorname",            value: firstName,                          warn: false },
        { label: "Geburtsdatum",       value: fmtDate(profile.dob),              warn: false },
        { label: "Geschlecht",         value: sexLabel,                           warn: false },
        { label: "Staatsangehörigkeit",value: natAdjDe(profile.nationality),     warn: false },
        { label: "Geburtsort",         value: up(profile.city_of_birth),         warn: false },
        { label: "Geburtsland",        value: countryDe(profile.country_of_birth), warn: false },
      ],
    },
    {
      title: "Reisepassdaten",
      rows: [
        { label: "Reisepassnummer",    value: up(profile.passport_no),           warn: false },
        { label: "Ausstellungsdatum",  value: fmtDate(profile.issue_date),       warn: false },
        { label: "Ablaufdatum",        value: expiryStr,                          warn: !!expired },
        { label: "Ausstellungsbehörde",value: up(profile.issuing_authority),     warn: false },
      ],
    },
    {
      title: "Wohnanschrift",
      rows: [
        { label: "Straße / Adresse",   value: up(profile.address_street),        warn: false },
        { label: "Hausnummer",         value: up(profile.address_number) === "—" ? "—" : String(profile.address_number ?? "—"), warn: false },
        { label: "Postleitzahl",       value: profile.address_postal ?? "—",     warn: false },
        { label: "Wohnort",            value: up(profile.city_of_residence),     warn: false },
        { label: "Wohnland",           value: countryDe(profile.country_of_residence), warn: false },
      ],
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = React.createElement(Document, null,
    React.createElement(Page, { size: "A4", style: styles.page },

      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.title }, "Reisepassdaten"),
        React.createElement(Text, { style: styles.subtitle }, `Kandidat: ${fullName}  ·  Erstellt: ${todayStr}`)
      ),

      // Groups
      ...groups.map(g =>
        React.createElement(View, { style: styles.section, key: g.title },
          React.createElement(Text, { style: styles.sectionTitle }, g.title),
          ...g.rows.map(r =>
            React.createElement(View, { style: styles.row, key: r.label },
              React.createElement(Text, { style: styles.label }, r.label),
              React.createElement(Text, { style: r.warn ? styles.warn : styles.value }, r.value)
            )
          )
        )
      ),

      // Footer
      React.createElement(Text, { style: styles.footer },
        `Borivon — Automatisch generiert am ${todayStr}`
      )
    )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;

  const buf = await renderToBuffer(el);
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ── Google Drive helpers ──────────────────────────────────────────────────────
export function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

export const ROOT_FOLDER_ID = () => process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";

/**
 * Grant "anyone with link" reader permission so the file can be embedded via
 * Google Drive's preview URL (`/file/d/{id}/preview`) without authentication.
 * Idempotent — safe to call repeatedly. Errors are swallowed so a transient
 * permission failure doesn't fail the surrounding upload.
 */
export async function makeDrivePublic(
  drive: ReturnType<typeof google.drive>,
  fileId: string
): Promise<void> {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  } catch (err) {
    console.error("makeDrivePublic failed for", fileId, err);
  }
}

/** Escape values for Drive's `q` query syntax — backslashes and single
   quotes both need escaping. Without this, a folder named "O'Connor"
   breaks the query and either errors or causes a duplicate folder to be
   created on every upload. */
function escapeDriveQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const safeName = escapeDriveQ(name);
  const safeParent = escapeDriveQ(parentId);
  const res = await drive.files.list({
    q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${safeParent}' in parents and trashed=false`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id!;
  const folder = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return folder.data.id!;
}

export function buildPdfFilename(profile: { first_name?: string | null; last_name?: string | null }): string {
  const fn = (profile.first_name ?? "vorname").trim().toLowerCase().replace(/\s+/g, "_") || "vorname";
  const ln = (profile.last_name  ?? "nachname").trim().toLowerCase().replace(/\s+/g, "_") || "nachname";
  return `${fn}_${ln}_reisepass_daten.pdf`;
}

/** Generate PDF and upload to Drive. Throws on error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function uploadPassportPdfToDrive(profile: any): Promise<string> {
  const buffer   = await generatePassportPdf(profile);
  const filename = buildPdfFilename(profile);
  const drive    = getDriveClient();
  const rootId   = ROOT_FOLDER_ID();
  const folderName = [profile.first_name?.trim(), profile.last_name?.trim()].filter(Boolean).join(" ") || String(profile.user_id ?? "unknown");
  const folderId = await getOrCreateFolder(drive, folderName, rootId);

  const stream = new PassThrough();
  stream.end(buffer);

  const driveRes = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media:       { mimeType: "application/pdf", body: stream },
    fields:      "id",
    supportsAllDrives: true,
  });
  return driveRes.data.id!;
}
