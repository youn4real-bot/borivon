import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type PassportDataPdfFields = {
  first_name: string | null; last_name: string | null; dob: string | null;
  sex: string | null; nationality: string | null;
  city_of_birth: string | null; country_of_birth: string | null;
  passport_no: string | null; passport_expiry: string | null;
  issuing_authority: string | null; issue_date: string | null;
  address_street: string | null; address_number: string | null;
  address_postal: string | null; city_of_residence: string | null;
  country_of_residence: string | null;
  marital_status: string | null; children_ages: string | null;
};

const styles = StyleSheet.create({
  page:     { fontFamily: "Lato", fontSize: 9, color: "#1a1a1a", padding: "32pt 36pt" },
  title:    { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  sub:      { fontSize: 9, color: "#666", marginBottom: 20 },
  divider:  { borderBottomWidth: 1, borderBottomColor: "#e5e5e5", marginBottom: 14, marginTop: 2 },
  row:      { flexDirection: "row", flexWrap: "wrap" },
  cell:     { width: "50%", marginBottom: 10, paddingRight: 12 },
  cellFull: { width: "100%", marginBottom: 10 },
  label:    { fontSize: 7.5, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  value:    { fontSize: 10, color: "#1a1a1a" },
});

function v(s: string | null | undefined): string {
  return s && s !== "—" && s.trim() !== "" ? s : "—";
}

export function PassportDataDocument({ p }: { p: PassportDataPdfFields }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Passport Data</Text>
        <Text style={styles.sub}>Extracted and confirmed passport information</Text>
        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.cell}><Text style={styles.label}>Last name</Text><Text style={styles.value}>{v(p.last_name)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>First name</Text><Text style={styles.value}>{v(p.first_name)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Date of birth</Text><Text style={styles.value}>{v(p.dob)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Sex</Text><Text style={styles.value}>{v(p.sex)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Nationality</Text><Text style={styles.value}>{v(p.nationality)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>City of birth</Text><Text style={styles.value}>{v(p.city_of_birth)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Country of birth</Text><Text style={styles.value}>{v(p.country_of_birth)}</Text></View>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.cell}><Text style={styles.label}>Passport number</Text><Text style={styles.value}>{v(p.passport_no)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Issue date</Text><Text style={styles.value}>{v(p.issue_date)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Expiry date</Text><Text style={styles.value}>{v(p.passport_expiry)}</Text></View>
          <View style={styles.cellFull}><Text style={styles.label}>Issuing authority</Text><Text style={styles.value}>{v(p.issuing_authority)}</Text></View>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.cellFull}><Text style={styles.label}>Street</Text><Text style={styles.value}>{v(p.address_street)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Number</Text><Text style={styles.value}>{v(p.address_number)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Postal code</Text><Text style={styles.value}>{v(p.address_postal)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>City</Text><Text style={styles.value}>{v(p.city_of_residence)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Country</Text><Text style={styles.value}>{v(p.country_of_residence)}</Text></View>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.cell}><Text style={styles.label}>Marital status</Text><Text style={styles.value}>{v(p.marital_status)}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Children ages</Text><Text style={styles.value}>{v(p.children_ages)}</Text></View>
        </View>
      </Page>
    </Document>
  );
}
