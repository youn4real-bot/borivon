import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type PassportDataPdfGroup = {
  title: string;
  fields: { label: string; value: string }[];
};

const GOLD  = "#C9A240";
const DARK  = "#0f0f0f";
const MID   = "#555555";
const LIGHT = "#999999";
const RULE  = "#e8e8e8";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Lato",
    fontSize: 9,
    color: DARK,
    backgroundColor: "#ffffff",
    paddingTop: 52,
    paddingBottom: 64,
    paddingHorizontal: 48,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  header: {
    marginBottom: 28,
  },
  headerAccent: {
    width: 28,
    height: 2,
    backgroundColor: GOLD,
    marginBottom: 12,
  },
  title: {
    fontFamily: "Lato",
    fontWeight: 700,
    fontSize: 18,
    color: DARK,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 8.5,
    color: LIGHT,
    letterSpacing: 0.3,
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    marginBottom: 20,
  },

  // ── Group ─────────────────────────────────────────────────────────────────
  group: {
    marginBottom: 22,
  },
  groupTitle: {
    fontSize: 7,
    fontWeight: 700,
    color: GOLD,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  field: {
    width: "50%",
    paddingRight: 16,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: LIGHT,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 9.5,
    fontWeight: 700,
    color: DARK,
    letterSpacing: 0.1,
  },
  fieldEmpty: {
    fontSize: 9.5,
    color: LIGHT,
  },

  // ── Spacer ────────────────────────────────────────────────────────────────
  spacer: {
    flex: 1,
  },

  // ── Footer logo ──────────────────────────────────────────────────────────
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RULE,
    marginTop: 12,
  },
  footerNote: {
    fontSize: 7,
    color: LIGHT,
    letterSpacing: 0.2,
  },
  logoText: {
    fontFamily: "DMSerifItalic",
    fontSize: 14,
    color: DARK,
  },
  logoDot: {
    fontFamily: "DMSerifItalic",
    fontSize: 14,
    color: GOLD,
  },
});

export function PassportDataDocument({ groups, docTitle, docSubtitle }: {
  groups: PassportDataPdfGroup[];
  docTitle?: string;
  docSubtitle?: string;
}) {
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerAccent} />
          <Text style={styles.title}>{docTitle ?? "Passport Data"}</Text>
          <Text style={styles.subtitle}>{docSubtitle ?? "Extracted and confirmed passport information"}</Text>
        </View>

        <View style={styles.rule} />

        {/* ── Field groups ── */}
        {groups.map((group, gi) => (
          <View key={gi} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.fieldRow}>
              {group.fields.map((f, fi) => (
                <View key={fi} style={styles.field}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  {f.value && f.value !== "—" ? (
                    <Text style={styles.fieldValue}>{f.value}</Text>
                  ) : (
                    <Text style={styles.fieldEmpty}>—</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.spacer} />

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerNote}>Generated {now}</Text>
          <View style={{ flexDirection: "row" }}>
            <Text style={styles.logoText}>Borivon</Text>
            <Text style={styles.logoDot}>.</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
}
