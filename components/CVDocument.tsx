/**
 * CVDocument.tsx — @react-pdf/renderer component (server-side only).
 * Premium minimalist German Lebenslauf using Lexend font.
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
import path from "path";

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

/** Branding injected by the generate API — defaults to Borivon when absent. */
export interface CVBrand {
  /** Absolute path to a logo image in public/logos/ — if absent, Borivon text logo renders. */
  logoPath?: string;
  /** Lines for the footer. Borivon default is ["contact@borivon.com"]. */
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

const DARK    = "#1C1C1E";
const NAVY    = "#1a3a5c";
const GOLD    = "#C9A84C";
const MUTED   = "#6B7280";
const DIVIDER = "#E2E6EA";
const FOOTER_COLOR = "#9CA3AF";

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Lexend",
    fontSize: 9,
    color: DARK,
    paddingTop: 36,
    paddingBottom: 28,
    paddingLeft: 44,
    paddingRight: 44,
    lineHeight: 1.45,
    backgroundColor: "#FFFFFF",
  },

  // ── Logo banner ──
  logoBanner: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  logoImage: {
    height: 54,
    objectFit: "contain",
  },
  logoTextRow: {
    flexDirection: "row",
    alignItems: "baseline",
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

  // ── Header rule ──
  headerRule: {
    height: 1.5,
    backgroundColor: NAVY,
    marginBottom: 11,
  },

  // ── Name + photo row ──
  nameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  nameLeft: {
    flex: 1,
    paddingRight: 14,
  },
  lebenslaufLabel: {
    fontSize: 7,
    fontWeight: 600,
    color: GOLD,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  candidateName: {
    fontSize: 20,
    fontWeight: 700,
    color: DARK,
    lineHeight: 1.15,
    marginBottom: 5,
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  contactItem: {
    fontSize: 8,
    color: MUTED,
    marginRight: 14,
    marginBottom: 1.5,
  },
  photo: {
    width: 76,
    height: 76,
    borderRadius: 4,
    objectFit: "cover",
  },

  // ── Divider ──
  divider: {
    height: 0.5,
    backgroundColor: DIVIDER,
    marginTop: 5,
    marginBottom: 7,
  },

  // ── Section ──
  section: { marginBottom: 6 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
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

  // ── Personal data grid ──
  pdGrid: { flexDirection: "row", flexWrap: "wrap" },
  pdItem: { width: "50%", marginBottom: 2.5, flexDirection: "row" },
  pdItemFull: { width: "100%", marginBottom: 2.5, flexDirection: "row" },
  pdLabel: { fontSize: 8, color: MUTED, width: 84 },
  pdValue: { fontSize: 8.5, color: DARK, flex: 1 },

  // ── Timeline entries ──
  entry: { marginBottom: 5.5, flexDirection: "row" },
  entryDate: { fontSize: 8, color: MUTED, width: 72, paddingTop: 1 },
  entryRight: { flex: 1 },
  entryTitle: { fontSize: 9, fontWeight: 700, color: DARK, marginBottom: 1 },
  entrySubtitle: { fontSize: 8, color: MUTED, marginBottom: 1 },
  entryDept: { fontSize: 8, color: GOLD, marginTop: 1 },
  entryGap: { fontSize: 8.5, color: MUTED },
  entryGapReason: { fontSize: 8, color: MUTED },

  // ── Languages ──
  langRow: { flexDirection: "row", flexWrap: "wrap" },
  langItem: { marginRight: 18, marginBottom: 2.5, flexDirection: "row", alignItems: "baseline" },
  langName: { fontSize: 9, fontWeight: 700, marginRight: 3 },
  langLevel: { fontSize: 8, color: MUTED },

  // ── EDV chips ──
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

  // ── Sonstiges ──
  miscRow: { flexDirection: "row", flexWrap: "wrap" },
  miscItem: { marginRight: 20, marginBottom: 2.5, flexDirection: "row" },
  miscLabel: { fontSize: 8, color: MUTED, width: 84 },
  miscValue: { fontSize: 8.5, color: DARK, flex: 1 },

  // ── Signature / date area ──
  sigArea: {
    marginTop: 22,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigSlot: { width: 115 },
  sigSpace: { height: 38 },
  sigLine: { height: 0.5, backgroundColor: MUTED, marginBottom: 3 },
  sigLabel: { fontSize: 7.5, color: MUTED },

  // ── Footer ──
  footer: {
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: DIVIDER,
    alignItems: "center",
  },
  footerLine: {
    fontSize: 7.5,
    color: FOOTER_COLOR,
    textAlign: "center",
    lineHeight: 1.55,
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

  // Effective branding — fall back to Borivon defaults
  const footerLines = brand?.footerLines?.length ? brand.footerLines : ["contact@borivon.com"];

  // Sort work: newest first
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

  const allEdv      = [...data.edvSelected, ...data.edvCustomInputs.filter(Boolean)];
  const activeLangs = data.langs.filter(l => l.name && l.level);

  // Build contact line items (plain text, no emojis — keeps PDF clean and printable)
  const contactItems: string[] = [];
  if (data.phone) contactItems.push(data.phone);
  if (data.email) contactItems.push(data.email);
  const addrParts = [data.address, [data.postalCode, data.city].filter(Boolean).join(" ")].filter(Boolean);
  if (addrParts.length) contactItems.push(addrParts.join(", "));

  // Full address string for personal data section
  const fullAddress = [data.address, [data.postalCode, data.city].filter(Boolean).join(" "), data.countryOfResidence]
    .filter(Boolean).join(", ");

  // Nationalities (primary + additional)
  const allNationalities = [data.nationality, ...(data.additionalNationalities ?? [])].filter(Boolean);

  return (
    <Document title={`Lebenslauf – ${fullName}`} author="Borivon" language="de">
      <Page size="A4" style={s.page} wrap>

        {/* ── 1. LOGO BANNER ── */}
        <View style={s.logoBanner}>
          {brand?.logoPath ? (
            <Image src={brand.logoPath} style={s.logoImage} />
          ) : (
            <View style={s.logoTextRow}>
              <Text style={s.logoText}>Borivon</Text>
              <Text style={s.logoGold}>.</Text>
            </View>
          )}
        </View>

        {/* ── 2. NAVY RULE ── */}
        <View style={s.headerRule} />

        {/* ── 3. NAME + CONTACT + PHOTO ── */}
        <View style={s.nameRow}>
          <View style={s.nameLeft}>
            <Text style={s.lebenslaufLabel}>Lebenslauf</Text>
            <Text style={s.candidateName}>{fullName || "Vorname Nachname"}</Text>
            <View style={s.contactRow}>
              {contactItems.map((item, i) => (
                <Text key={i} style={s.contactItem}>{item}</Text>
              ))}
            </View>
          </View>
          {data.photo ? <Image src={data.photo} style={s.photo} /> : null}
        </View>

        <View style={s.divider} />

        {/* ── 4. PERSÖNLICHE DATEN ── */}
        <View style={s.section}>
          <SectionHead title="Persönliche Daten" />
          <View style={s.pdGrid}>
            <PDItem label="Geburtsdatum"    value={data.birthDate} />
            <PDItem label="Geburtsort"      value={data.birthPlace} />
            {data.countryOfBirth     ? <PDItem label="Geburtsland"      value={data.countryOfBirth} /> : null}
            {allNationalities.length ? <PDItem label="Staatsangehörig." value={allNationalities.join(", ")} /> : null}
            {data.maritalStatus      ? <PDItem label="Familienstand"    value={data.maritalStatus} /> : null}
            {fullAddress             ? <PDItem label="Adresse"          value={fullAddress} full /> : null}
          </View>
        </View>

        <View style={s.divider} />

        {/* ── 5. BERUFSERFAHRUNG ── */}
        {allWork.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Berufserfahrung" />
            {allWork.map(e => <WorkRow key={e.id} entry={e} />)}
          </View>
        )}
        {allWork.length > 0 && <View style={s.divider} />}

        {/* ── 6. BILDUNGSWEG ── */}
        {allEdu.length > 0 && (
          <View style={s.section}>
            <SectionHead title="Bildungsweg" />
            {allEdu.map(e => <EduRow key={e.id} entry={e} />)}
          </View>
        )}
        {allEdu.length > 0 && <View style={s.divider} />}

        {/* ── 7. SPRACHKENNTNISSE ── */}
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
        {activeLangs.length > 0 && <View style={s.divider} />}

        {/* ── 8. EDV-KENNTNISSE ── */}
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
        {allEdv.length > 0 && <View style={s.divider} />}

        {/* ── 9. SONSTIGES ── */}
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

        {/* ── 10. SIGNATURE / DATE AREA ── */}
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

        {/* ── 11. FOOTER ── */}
        <View style={s.footer}>
          {footerLines.map((line, i) => (
            <Text key={i} style={s.footerLine}>{line}</Text>
          ))}
        </View>

      </Page>
    </Document>
  );
}
