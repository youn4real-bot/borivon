import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type PassportDataPdfGroup = {
  title: string;
  fields: { label: string; value: string }[];
};

const styles = StyleSheet.create({
  page:    { fontFamily: "Lato", fontSize: 9, color: "#1a1a1a", padding: "32pt 36pt" },
  title:   { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  sub:     { fontSize: 9, color: "#666", marginBottom: 20 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e5e5e5", marginBottom: 14, marginTop: 2 },
  grpTitle:{ fontSize: 8, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  row:     { flexDirection: "row", flexWrap: "wrap" },
  cell:    { width: "50%", marginBottom: 10, paddingRight: 12 },
  label:   { fontSize: 7.5, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  value:   { fontSize: 10, color: "#1a1a1a" },
});

export function PassportDataDocument({ groups, docTitle, docSubtitle }: {
  groups: PassportDataPdfGroup[];
  docTitle?: string;
  docSubtitle?: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{docTitle ?? "Passport Data"}</Text>
        <Text style={styles.sub}>{docSubtitle ?? "Extracted and confirmed passport information"}</Text>
        <View style={styles.divider} />
        {groups.map((group, gi) => (
          <View key={gi} style={{ marginBottom: 14 }}>
            <Text style={styles.grpTitle}>{group.title}</Text>
            <View style={styles.row}>
              {group.fields.map((f, fi) => (
                <View key={fi} style={styles.cell}>
                  <Text style={styles.label}>{f.label}</Text>
                  <Text style={styles.value}>{f.value || "—"}</Text>
                </View>
              ))}
            </View>
            {gi < groups.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </Page>
    </Document>
  );
}
