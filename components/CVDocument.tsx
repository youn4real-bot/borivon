/**
 * CVDocument.tsx — @react-pdf/renderer component (server-side only).
 * Generates a professional German Lebenslauf with Lato font and clean layout.
 * Do NOT add "use client" here.
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

/** Country (German name) where the employer is based — shown on the CV.
   Stored on every WorkEntry so each position can be in a different country. */
export interface WorkEntry {
  id: string;
  isGap: boolean;
  title: string;
  employer: string;
  location: string;
  /** Country (German name, e.g. "Marokko") — defaults to Marokko on new entries. */
  country?: string;
  /** Additional internship sites — only used by the mandatory Position-1
      nursing internship (Praktikum). Most nurses train across several
      hospitals/cities in the same period; each site has its own
      establishment/city/country and shows up as an extra line on the CV. */
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
  /** Official date the diploma was issued (different from training end date,
      since the diploma usually arrives months after training ends). */
  diplomaIssued?: MonthYear;
  /** Abitur specialization track (German term used on the CV).
      Moroccan baccalaureate has 10 main tracks (PC, SVT, Math, Économie, …). */
  abiturFocus?: string;
  /** Country where the institution is based (German country name).
      Used for Abitur and any other education entry where it matters. */
  country?: string;
}

export interface CVData {
  photo: string | null;
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  /** Country of birth (German country name, e.g. "Marokko"). Extracted from passport. */
  countryOfBirth?: string;
  /** Country of residence (German country name). Defaults to Marokko. */
  countryOfResidence?: string;
  nationality: string;
  /** Additional nationalities (German country names, e.g. "Frankreich").
      Up to 4 — total of 5 with the primary `nationality`. */
  additionalNationalities?: string[];
  maritalStatus: string;       // e.g. "ledig" | "verheiratet, 2 Kinder (14, 8)"
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

const NAVY  = "#1a3a5c";
const GOLD  = "#c8a94a";
const TEXT  = "#1c1c1c";
const MUTED = "#606060";
const RULE  = "#dedede";
const GOLD_LIGHT = "#f5edda";

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Lato",
    fontSize: 9.5,
    color: TEXT,
    paddingTop: 40,
    paddingBottom: 48,
    paddingLeft: 48,
    paddingRight: 48,
    lineHeight: 1.5,
  },

  // ── Header ──
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 0,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  headerBadge: {
    fontSize: 8,
    fontFamily: "Lato",
    fontWeight: 700,
    letterSpacing: 2.5,
    color: GOLD,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headerName: {
    fontSize: 22,
    fontFamily: "Lato",
    fontWeight: 700,
    color: NAVY,
    lineHeight: 1.15,
    marginBottom: 6,
  },
  headerContact: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  headerContactItem: {
    fontSize: 8.5,
    color: MUTED,
    marginRight: 14,
    marginBottom: 2,
  },
  headerRule: {
    height: 2,
    backgroundColor: NAVY,
    marginTop: 10,
    marginBottom: 14,
  },
  photo: {
    width: 72,
    height: 90,
    objectFit: "cover",
    borderRadius: 4,
  },

  // ── Section ──
  section: { marginBottom: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
    paddingBottom: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: NAVY,
  },
  sectionTitle: {
    fontSize: 8.5,
    fontFamily: "Lato",
    fontWeight: 700,
    color: NAVY,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },

  // ── Personal data ──
  pdGrid: { flexDirection: "row", flexWrap: "wrap" },
  pdItem: { width: "50%", marginBottom: 3, flexDirection: "row" },
  pdItemFull: { width: "100%", marginBottom: 3, flexDirection: "row" },
  pdLabel: { fontSize: 8.5, color: MUTED, width: 90, fontFamily: "Lato" },
  pdValue: { fontSize: 9, color: TEXT, flex: 1, fontFamily: "Lato" },

  // ── Timeline entries ──
  entry: { marginBottom: 7, flexDirection: "row" },
  entryDate: {
    fontSize: 8.5,
    color: MUTED,
    width: 90,
    paddingTop: 1,
    fontFamily: "Lato",
  },
  entryRight: { flex: 1 },
  entryTitle: {
    fontSize: 9.5,
    fontFamily: "Lato",
    fontWeight: 700,
    color: TEXT,
    marginBottom: 1.5,
  },
  entrySubtitle: { fontSize: 9, color: MUTED, marginBottom: 1.5, fontFamily: "Lato" },
  entryDept: {
    fontSize: 8.5,
    color: GOLD,
    fontFamily: "Lato",
    marginTop: 1,
  },
  entryGap: {
    fontSize: 9,
    color: MUTED,
    fontFamily: "Lato",
  },
  entryGapReason: {
    fontSize: 8.5,
    color: MUTED,
    fontFamily: "Lato",
  },

  // ── Divider ──
  divRule: { height: 0.5, backgroundColor: RULE, marginBottom: 9, marginTop: 1 },

  // ── Languages ──
  langRow: { flexDirection: "row", flexWrap: "wrap" },
  langItem: {
    marginRight: 20,
    marginBottom: 3,
    flexDirection: "row",
    alignItems: "baseline",
  },
  langName: { fontSize: 9.5, fontFamily: "Lato", fontWeight: 700, marginRight: 4 },
  langLevel: { fontSize: 9, color: MUTED, fontFamily: "Lato" },

  // ── EDV chips ──
  edvRow: { flexDirection: "row", flexWrap: "wrap" },
  edvChip: {
    fontSize: 8.5,
    color: TEXT,
    marginRight: 5,
    marginBottom: 4,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderWidth: 0.75,
    borderColor: RULE,
    borderRadius: 3,
    backgroundColor: "#f9f9f9",
    fontFamily: "Lato",
  },

  // ── Sonstiges ──
  miscRow: { flexDirection: "row", flexWrap: "wrap" },
  miscItem: {
    marginRight: 20,
    marginBottom: 3,
    flexDirection: "row",
  },
  miscLabel: { fontSize: 8.5, color: MUTED, width: 90, fontFamily: "Lato" },
  miscValue: { fontSize: 9, color: TEXT, flex: 1, fontFamily: "Lato" },

  // ── Footer ──
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
  },
  footerLine: { width: 130, height: 0.5, backgroundColor: RULE, marginBottom: 3 },
  footerLabel: { fontSize: 7.5, color: MUTED, fontFamily: "Lato" },

  // ── Gold accent bar ──
  accentBar: {
    width: 3,
    height: 11,
    backgroundColor: GOLD,
    borderRadius: 1.5,
    marginRight: 6,
  },
});

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <View style={s.accentBar} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function PDItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  if (!value) return null;
  return (
    <View style={full ? s.pdItemFull : s.pdItem}>
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
          return line ? (
            <Text key={i} style={s.entrySubtitle}>{line}</Text>
          ) : null;
        })}
        {entry.departments.length > 0 ? (
          <Text style={s.entryDept}>
            {entry.departments.join("  ·  ")}
          </Text>
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
        {entry.type === "abitur" && entry.abiturFocus && entry.abiturFocus.trim() ? (
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

export function CVDocument({ data }: { data: CVData }) {
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");

  // Sort work: newest first (undated entries at end)
  const datedWork = [...data.workEntries]
    .filter(e => e.start.month && e.start.year)
    .sort((a, b) =>
      (parseInt(b.start.year) * 12 + parseInt(b.start.month)) -
      (parseInt(a.start.year) * 12 + parseInt(a.start.month))
    );
  const undatedWork = data.workEntries.filter(e => !datedWork.find(d => d.id === e.id));
  const allWork = [...datedWork, ...undatedWork];

  // Sort edu: newest first
  const datedEdu = [...data.eduEntries]
    .filter(e => e.start.month && e.start.year)
    .sort((a, b) =>
      (parseInt(b.start.year) * 12 + parseInt(b.start.month)) -
      (parseInt(a.start.year) * 12 + parseInt(a.start.month))
    );
  const undatedEdu = data.eduEntries.filter(e => !datedEdu.find(d => d.id === e.id));
  const allEdu = [...datedEdu, ...undatedEdu];

  const allEdv = [...data.edvSelected, ...data.edvCustomInputs.filter(Boolean)];
  const activeLangs = data.langs.filter(l => l.name && l.level);

  const contactItems: string[] = [];
  if (data.phone) contactItems.push(`📞 ${data.phone}`);
  if (data.email) contactItems.push(`✉ ${data.email}`);
  const addrParts = [data.address, [data.postalCode, data.city].filter(Boolean).join(" ")].filter(Boolean);
  if (addrParts.length) contactItems.push(`⌂ ${addrParts.join(", ")}`);

  return (
    <Document title={`Lebenslauf – ${fullName}`} author="Borivon" language="de">
      <Page size="A4" style={s.page} wrap>

        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.headerBadge}>Lebenslauf</Text>
            <Text style={s.headerName}>{fullName || "Vorname Nachname"}</Text>
            <View style={s.headerContact}>
              {contactItems.map((c, i) => (
                <Text key={i} style={s.headerContactItem}>{c}</Text>
              ))}
            </View>
          </View>
          {data.photo ? <Image src={data.photo} style={s.photo} /> : null}
        </View>
        <View style={s.headerRule} />

        {/* ── Persönliche Daten ── */}
        <View style={s.section}>
          <SectionHead title="Persönliche Daten" />
          <View style={s.pdGrid}>
            <PDItem label="Geburtsdatum" value={data.birthDate} />
            <PDItem label="Geburtsort"   value={data.birthPlace} />
            {data.nationality    ? <PDItem label="Staatsangehörig." value={data.nationality}    /> : null}
            {data.maritalStatus  ? <PDItem label="Familienstand"    value={data.maritalStatus}  /> : null}
          </View>
        </View>

        <View style={s.divRule} />

        {/* ── Berufserfahrung ── */}
        {allWork.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Berufserfahrung" />
            {allWork.map(e => <WorkRow key={e.id} entry={e} />)}
          </View>
        )}
        {allWork.length > 0 && <View style={s.divRule} />}

        {/* ── Bildungsweg ── */}
        {allEdu.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Bildungsweg" />
            {allEdu.map(e => <EduRow key={e.id} entry={e} />)}
          </View>
        )}
        {allEdu.length > 0 && <View style={s.divRule} />}

        {/* ── Sprachkenntnisse ── */}
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
        {activeLangs.length > 0 && <View style={s.divRule} />}

        {/* ── EDV-Kenntnisse ── */}
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
        {allEdv.length > 0 && <View style={s.divRule} />}

        {/* ── Sonstiges ── */}
        {(data.driverLicense === "B" || data.hobbies) && (
          <View style={s.section}>
            <SectionHead title="Sonstiges" />
            <View style={s.miscRow}>
              {data.driverLicense === "B" ? (
                <View style={s.miscItem}>
                  <Text style={s.miscLabel}>Führerschein</Text>
                  <Text style={s.miscValue}>Klasse {data.driverLicense}</Text>
                </View>
              ) : null}
              {data.hobbies ? (
                <View style={[s.miscItem, { width: "100%" }]}>
                  <Text style={s.miscLabel}>Interessen</Text>
                  <Text style={s.miscValue}>{data.hobbies}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* ── Signature footer ── */}
        <View style={s.footer}>
          <View>
            <View style={s.footerLine} />
            <Text style={s.footerLabel}>Ort, Datum</Text>
          </View>
          <View>
            <View style={s.footerLine} />
            <Text style={s.footerLabel}>Unterschrift</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
}
