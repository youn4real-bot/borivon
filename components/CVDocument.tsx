/**
 * CVDocument.tsx — @react-pdf/renderer component (server-side only).
 * Do NOT add "use client" here.
 *
 * Layout:
 *  - Fixed header (logo + rule) on every page — like a Word/Docs header
 *  - Fixed footer (contact line) on every page — like a Word/Docs footer
 *  - Personal data as vertical list with photo on the right
 */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthYear { month: string; year: string }

export interface WorkEntry {
  id: string;
  isGap: boolean;
  title: string;
  employer: string;
  location: string;
  country?: string;
  additionalSites?: { employer: string; location: string; country?: string }[];
  departments: string[];
  start: MonthYear;
  end: MonthYear | null;
  gapReason: string;
}

export interface EduEntry {
  id: string;
  type: "abitur" | "nursing" | "other";
  institution: string;
  location: string;
  start: MonthYear;
  end: MonthYear | null;
  degree: string;
  nursingStatus: "complete" | "year1" | "year2" | "year3";
  diplomaIssued?: MonthYear;
  abiturFocus?: string;
  country?: string;
}

export interface CVData {
  photo: string | null;
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  countryOfBirth?: string;
  countryOfResidence?: string;
  nationality: string;
  additionalNationalities?: string[];
  maritalStatus: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  workEntries: WorkEntry[];
  eduEntries: EduEntry[];
  langs: { name: string; level: string }[];
  edvSelected: string[];
  edvCustomInputs: string[];
  driverLicense: string;
  hobbies: string;
}

export interface CVBrand {
  /** Absolute path to logo image in public/logos/ */
  logoPath?: string;
  /** Footer lines. Default: ["contact@borivon.com"] */
  footerLines?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMY(my: MonthYear): string {
  if (!my.month || !my.year) return "";
  return `${my.month}.${my.year}`;
}

function dateRange(start: MonthYear, end: MonthYear | null): string {
  const s = fmtMY(start);
  const e = end ? fmtMY(end) : "aktuell";
  if (!s) return "";
  return `${s} – ${e}`;
}

function nursingLabel(status: string, degree: string): string {
  if (status === "year1") return `${degree} (1. Ausbildungsjahr)`;
  if (status === "year2") return `${degree} (2. Ausbildungsjahr)`;
  if (status === "year3") return `${degree} (3. Ausbildungsjahr)`;
  return degree;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const DARK         = "#1C1C1E";
const NAVY         = "#1a3a5c";
const GOLD         = "#C9A84C";
const MUTED        = "#6B7280";
const DIVIDER      = "#E2E6EA";
const FOOTER_COLOR = "#9CA3AF";

// Fixed header height: paddingTop(18) + logo(46) + gap(8) + bottom gap(8)
const HEADER_H = 80;
// Fixed footer height: paddingTop(6) + text(~9) + paddingBottom(11)
const FOOTER_H = 30;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Lexend",
    fontSize: 9,
    color: DARK,
    paddingTop: HEADER_H,
    paddingBottom: FOOTER_H,
    paddingLeft: 44,
    paddingRight: 44,
    lineHeight: 1.45,
    backgroundColor: "#FFFFFF",
  },

  // ── Fixed header — repeats on every page ──────────────────────────────────
  fixedHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 18,
    paddingHorizontal: 44,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  logoImage: {
    height: 46,
    objectFit: "contain",
  },
  logoTextRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  logoText: {
    fontFamily: "DMSerifItalic",
    fontSize: 22,
    color: DARK,
  },
  logoGold: {
    fontFamily: "DMSerifItalic",
    fontSize: 22,
    color: GOLD,
  },
  // ── Fixed footer — repeats on every page ──────────────────────────────────
  fixedFooter: {
    position: "absolute",
    bottom: 0,
    left: 44,
    right: 44,
    paddingTop: 6,
    paddingBottom: 11,
    alignItems: "center",
  },
  footerLine: {
    fontSize: 7.5,
    color: FOOTER_COLOR,
    textAlign: "center",
    lineHeight: 1.55,
  },

  // ── Document title ─────────────────────────────────────────────────────────
  docTitle: {
    fontSize: 7,
    fontWeight: 600,
    color: GOLD,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 10,
  },

  // ── Section ────────────────────────────────────────────────────────────────
  section: { marginBottom: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    paddingBottom: 3,
  },
  accentBar: {
    width: 2.5,
    height: 9,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginRight: 5,
  },
  sectionTitle: {
    fontSize: 7.5,
    fontWeight: 700,
    color: NAVY,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },

  // ── Personal data — vertical list with photo ───────────────────────────────
  pdWithPhoto: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  pdRows: {
    flex: 1,
    paddingRight: 14,
  },
  pdRow: {
    flexDirection: "row",
    marginBottom: 3.5,
  },
  pdLabel: {
    fontSize: 8,
    color: MUTED,
    width: 105,
    flexShrink: 0,
  },
  pdValue: {
    fontSize: 8.5,
    color: DARK,
    flex: 1,
  },
  photo: {
    width: 78,
    height: 78,
    borderRadius: 4,
    objectFit: "cover",
    flexShrink: 0,
  },

  // ── Divider ────────────────────────────────────────────────────────────────
  divider: {
    height: 0.5,
    backgroundColor: DIVIDER,
    marginTop: 5,
    marginBottom: 8,
  },

  // ── Timeline entries ───────────────────────────────────────────────────────
  entry: { marginBottom: 6, flexDirection: "row" },
  entryDate: { fontSize: 8, color: MUTED, width: 105, paddingTop: 1, flexShrink: 0 },
  entryRight: { flex: 1 },
  entryTitle: { fontSize: 9, fontWeight: 700, color: DARK, marginBottom: 1.5 },
  entrySubtitle: { fontSize: 8, color: MUTED, marginBottom: 1 },
  entryDept: { fontSize: 8, color: GOLD, marginTop: 1.5 },
  entryGap: { fontSize: 8.5, color: MUTED },
  entryGapReason: { fontSize: 8, color: MUTED },

  // ── Languages ──────────────────────────────────────────────────────────────
  langRow: { flexDirection: "row", flexWrap: "wrap" },
  langItem: { marginRight: 20, marginBottom: 3, flexDirection: "row", alignItems: "baseline" },
  langName: { fontSize: 9, fontWeight: 700, marginRight: 3 },
  langLevel: { fontSize: 8, color: MUTED },

  // ── EDV chips ──────────────────────────────────────────────────────────────
  edvRow: { flexDirection: "row", flexWrap: "wrap" },
  edvChip: {
    fontSize: 8,
    color: DARK,
    marginRight: 4,
    marginBottom: 3,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderWidth: 0.5,
    borderColor: DIVIDER,
    borderRadius: 3,
    backgroundColor: "#F9FAFB",
  },

  // ── Sonstiges ─────────────────────────────────────────────────────────────
  miscRow: {
    flexDirection: "row",
    marginBottom: 3.5,
  },
  miscLabel: { fontSize: 8, color: MUTED, width: 105, flexShrink: 0 },
  miscValue: { fontSize: 8.5, color: DARK, flex: 1 },

  // ── Signature area ─────────────────────────────────────────────────────────
  sigArea: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigSlot: { width: 115 },
  sigSpace: { height: 40 },
  sigLine: { height: 0.5, backgroundColor: MUTED, marginBottom: 3 },
  sigLabel: { fontSize: 7.5, color: MUTED },
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <View style={s.accentBar} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function PDRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={s.pdRow}>
      <Text style={s.pdLabel}>{label}</Text>
      <Text style={s.pdValue}>{value}</Text>
    </View>
  );
}

function WorkRow({ entry }: { entry: WorkEntry }) {
  const dr = dateRange(entry.start, entry.end);
  if (entry.isGap) {
    return (
      <View style={s.entry}>
        <Text style={s.entryDate}>{dr}</Text>
        <View style={s.entryRight}>
          <Text style={s.entryGap}>Nicht berufstätig</Text>
          {entry.gapReason ? <Text style={s.entryGapReason}>{entry.gapReason}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={s.entry}>
      <Text style={s.entryDate}>{dr}</Text>
      <View style={s.entryRight}>
        {entry.title ? <Text style={s.entryTitle}>{entry.title}</Text> : null}
        {(entry.employer || entry.location || entry.country) ? (
          <Text style={s.entrySubtitle}>
            {[entry.employer, entry.location, entry.country].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {(entry.additionalSites ?? []).map((site, i) => {
          const line = [site.employer, site.location, site.country].filter(Boolean).join(" · ");
          return line ? <Text key={i} style={s.entrySubtitle}>{line}</Text> : null;
        })}
        {entry.departments.length > 0 ? (
          <Text style={s.entryDept}>{entry.departments.join("  ·  ")}</Text>
        ) : null}
      </View>
    </View>
  );
}

function EduRow({ entry }: { entry: EduEntry }) {
  const label = entry.type === "nursing"
    ? nursingLabel(entry.nursingStatus, entry.degree || "Krankenpflegediplom")
    : (entry.degree || "");
  const dr = dateRange(entry.start, entry.end);
  return (
    <View style={s.entry}>
      <Text style={s.entryDate}>{dr}</Text>
      <View style={s.entryRight}>
        {label ? <Text style={s.entryTitle}>{label}</Text> : null}
        {entry.type === "abitur" && entry.abiturFocus?.trim() ? (
          <Text style={s.entrySubtitle}>Schwerpunkt: {entry.abiturFocus.trim()}</Text>
        ) : null}
        {(entry.institution || entry.location || entry.country) ? (
          <Text style={s.entrySubtitle}>
            {[entry.institution, entry.location, entry.country].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {entry.type === "nursing" && entry.nursingStatus === "complete"
          && entry.diplomaIssued?.month && entry.diplomaIssued?.year ? (
          <Text style={s.entrySubtitle}>Diplom ausgestellt: {fmtMY(entry.diplomaIssued)}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Main document ────────────────────────────────────────────────────────────

export function CVDocument({ data, brand }: { data: CVData; brand?: CVBrand }) {
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");
  const footerLines = brand?.footerLines?.length ? brand.footerLines : ["contact@borivon.com"];

  const allNationalities = [data.nationality, ...(data.additionalNationalities ?? [])].filter(Boolean);
  const fullAddress = [
    data.address,
    [data.postalCode, data.city].filter(Boolean).join(" "),
    data.countryOfResidence,
  ].filter(Boolean).join(", ");

  // Sort work: newest first
  const datedWork = [...data.workEntries]
    .filter(e => e.start.month && e.start.year)
    .sort((a, b) =>
      (parseInt(b.start.year) * 12 + parseInt(b.start.month)) -
      (parseInt(a.start.year) * 12 + parseInt(a.start.month))
    );
  const allWork = [...datedWork, ...data.workEntries.filter(e => !datedWork.find(d => d.id === e.id))];

  // Sort edu: newest first
  const datedEdu = [...data.eduEntries]
    .filter(e => e.start.month && e.start.year)
    .sort((a, b) =>
      (parseInt(b.start.year) * 12 + parseInt(b.start.month)) -
      (parseInt(a.start.year) * 12 + parseInt(a.start.month))
    );
  const allEdu = [...datedEdu, ...data.eduEntries.filter(e => !datedEdu.find(d => d.id === e.id))];

  const allEdv      = [...data.edvSelected, ...data.edvCustomInputs.filter(Boolean)];
  const activeLangs = data.langs.filter(l => l.name && l.level);

  return (
    <Document title={`Lebenslauf – ${fullName}`} author="Borivon" language="de">
      <Page size="A4" style={s.page} wrap>

        {/* ── FIXED HEADER — logo + rule, every page ── */}
        <View fixed style={s.fixedHeader}>
          <View style={s.logoWrap}>
            {brand?.logoPath ? (
              <Image src={brand.logoPath} style={s.logoImage} />
            ) : (
              <View style={s.logoTextRow}>
                <Text style={s.logoText}>Borivon</Text>
                <Text style={s.logoGold}>.</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── FIXED FOOTER — contact line, every page ── */}
        <View fixed style={s.fixedFooter}>
          {footerLines.map((line, i) => (
            <Text key={i} style={s.footerLine}>{line}</Text>
          ))}
        </View>

        {/* ── DOCUMENT TITLE ── */}
        <Text style={s.docTitle}>Lebenslauf</Text>

        {/* ── PERSÖNLICHE DATEN ── */}
        <View style={s.section}>
          <SectionHead title="Persönliche Daten" />
          <View style={s.pdWithPhoto}>
            <View style={s.pdRows}>
              <PDRow label="Vorname"           value={data.firstName} />
              <PDRow label="Nachname"          value={data.lastName} />
              <PDRow label="Geburtsdatum"      value={data.birthDate} />
              <PDRow label="Geburtsort"        value={[data.birthPlace, data.countryOfBirth].filter(Boolean).join(", ")} />
              {allNationalities.length ? <PDRow label="Staatsangehörigkeit" value={allNationalities.join(", ")} /> : null}
              {data.maritalStatus      ? <PDRow label="Familienstand"     value={data.maritalStatus} /> : null}
              {fullAddress             ? <PDRow label="Adresse"           value={fullAddress} /> : null}
              {data.phone              ? <PDRow label="Telefon"           value={data.phone} /> : null}
              {data.email              ? <PDRow label="E-Mail"            value={data.email} /> : null}
            </View>
            {data.photo ? <Image src={data.photo} style={s.photo} /> : null}
          </View>
        </View>

        {/* ── BERUFSERFAHRUNG ── */}
        {allWork.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Berufserfahrung" />
            {allWork.map(e => <WorkRow key={e.id} entry={e} />)}
          </View>
        )}

        {/* ── BILDUNGSWEG ── */}
        {allEdu.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Bildungsweg" />
            {allEdu.map(e => <EduRow key={e.id} entry={e} />)}
          </View>
        )}

        {/* ── SPRACHKENNTNISSE ── */}
        {activeLangs.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Sprachkenntnisse" />
            <View style={s.langRow}>
              {activeLangs.map((l, i) => (
                <View key={i} style={s.langItem}>
                  <Text style={s.langName}>{l.name}:</Text>
                  <Text style={s.langLevel}>{l.level}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── EDV-KENNTNISSE ── */}
        {allEdv.length > 0 && (
          <View style={s.section}>
            <SectionHead title="EDV-Kenntnisse" />
            <View style={s.edvRow}>
              {allEdv.map((skill, i) => (
                <Text key={i} style={s.edvChip}>{skill}</Text>
              ))}
            </View>
          </View>
        )}

        {/* ── SONSTIGES + UNTERSCHRIFT — kept together with wrap={false} ──
            This guarantees the signature never lands on a page alone.
            If both don't fit at the bottom of the current page, react-pdf
            moves the whole block to the next page so it starts with the
            "Sonstiges" section header. ── */}
        <View wrap={false}>
          {(data.driverLicense === "B" || data.hobbies) && (
            <View style={s.section}>
              <SectionHead title="Sonstiges" />
              {data.driverLicense === "B" ? (
                <View style={s.miscRow}>
                  <Text style={s.miscLabel}>Führerschein</Text>
                  <Text style={s.miscValue}>Klasse B</Text>
                </View>
              ) : null}
              {data.hobbies ? (
                <View style={s.miscRow}>
                  <Text style={s.miscLabel}>Interessen</Text>
                  <Text style={s.miscValue}>{data.hobbies}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* ── UNTERSCHRIFT / DATUM ── */}
          <View style={s.sigArea}>
            <View style={s.sigSlot}>
              <View style={s.sigSpace} />
              <View style={s.sigLine} />
              <Text style={s.sigLabel}>Ort, Datum</Text>
            </View>
            <View style={s.sigSlot}>
              <View style={s.sigSpace} />
              <View style={s.sigLine} />
              <Text style={s.sigLabel}>Unterschrift</Text>
            </View>
          </View>
        </View>

      </Page>
    </Document>
  );
}
