/**
 * B2ReportDocument — @react-pdf/renderer doc for the admin B2-status export.
 * Matches the CV builder's look: Lexend body, the "Borivon." DM-Serif logo
 * header, and the contact footer — both repeated on every page. Server-side only
 * (rendered via renderToBuffer in the b2-report route). Fonts are registered by
 * the route through lib/pdf-fonts.registerPdfFonts().
 */
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { B2_STAGE_BY_KEY, type B2Stage } from "@/lib/b2Journey";

const DARK = "#1C1C1E";
const GOLD = "#C9A84C";
const MUTED = "#6B7280";
const DIVIDER = "#E2E6EA";
const FOOTER_COLOR = "#9CA3AF";
const HEADER_H = 80;
const FOOTER_H = 56;

export type B2ReportRow = {
  name: string;
  stage: B2Stage;
  failed: boolean;
  cert: "approved" | "pending" | "none";
  examDate: string | null;
  german: string;
  germanLevel: string | null;
};

const deDate = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
const statusDe = (stage: B2Stage): string =>
  stage === "passed" ? "B2 bestanden"
  : stage === "awaiting_results" ? "Prüfung abgelegt – Ergebnis ausstehend"
  : stage === "exam_booked" ? "Prüfungstermin gebucht & bezahlt (bestätigt)"
  : stage === "expected_date" ? "Voraussichtlicher Termin bestätigt"
  : "Lernphase – sucht noch einen Termin";

const s = StyleSheet.create({
  page: { fontFamily: "Lexend", fontSize: 9, color: DARK, paddingTop: HEADER_H, paddingBottom: FOOTER_H, paddingLeft: 44, paddingRight: 44, lineHeight: 1.45, backgroundColor: "#FFFFFF" },
  fixedHeader: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 18, paddingHorizontal: 44 },
  logoWrap: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", marginBottom: 8 },
  logoText: { fontFamily: "DMSerifItalic", fontSize: 22, color: DARK },
  logoGold: { fontFamily: "DMSerifItalic", fontSize: 22, color: GOLD },
  fixedFooter: { position: "absolute", bottom: 0, left: 44, right: 44, paddingTop: 6, paddingBottom: 11, alignItems: "center" },
  footerLine: { fontSize: 7.5, color: FOOTER_COLOR, textAlign: "center", lineHeight: 1.55 },

  title: { fontSize: 17, fontWeight: 700, color: DARK },
  sub: { fontSize: 9, color: MUTED, marginTop: 2, marginBottom: 10 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryDot: { width: 6, height: 6, borderRadius: 3 },
  summaryText: { fontSize: 8.5, color: MUTED },
  rule: { borderBottomWidth: 1, borderBottomColor: DIVIDER, marginBottom: 12 },

  row: { marginBottom: 12 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  nameWrap: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, flexWrap: "wrap" },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  name: { fontSize: 12, fontWeight: 700, color: DARK },
  level: { fontSize: 8, fontWeight: 700, color: GOLD },
  failed: { fontSize: 7.5, fontWeight: 700, color: "#ef4444" },
  stage: { fontSize: 9.5, fontWeight: 700, textAlign: "right", maxWidth: 230 },
  detail: { fontSize: 9.5, color: DARK, marginTop: 4, marginLeft: 12 },
  detailEmpty: { fontSize: 9.5, color: MUTED, marginTop: 4, marginLeft: 12 },
  meta: { fontSize: 8.5, color: MUTED, marginTop: 3, marginLeft: 12 },
  sep: { borderBottomWidth: 0.5, borderBottomColor: "#EDEFF1", marginTop: 10 },
});

export function B2ReportDocument({ rows, generatedAt }: { rows: B2ReportRow[]; generatedAt: string }) {
  const counts = new Map<B2Stage, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  const summary = Object.values(B2_STAGE_BY_KEY).sort((a, b) => a.position - b.position)
    .map((d) => ({ ...d, n: counts.get(d.key as B2Stage) ?? 0 })).filter((d) => d.n > 0);

  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <View fixed style={s.fixedHeader}>
          <View style={s.logoWrap}>
            <Text style={s.logoText}>Borivon</Text>
            <Text style={s.logoGold}>.</Text>
          </View>
        </View>
        <View fixed style={s.fixedFooter}>
          <Text style={s.footerLine}>contact@borivon.com</Text>
        </View>

        <Text style={s.title}>B2-Status — Borivon</Text>
        <Text style={s.sub}>{rows.length} Kandidat{rows.length === 1 ? "" : "en"} · {generatedAt}</Text>

        <View style={s.summaryRow}>
          {summary.map((d) => (
            <View key={d.key} style={s.summaryItem}>
              <View style={[s.summaryDot, { backgroundColor: d.color }]} />
              <Text style={s.summaryText}>{d.n} {d.label.de}</Text>
            </View>
          ))}
        </View>
        <View style={s.rule} />

        {rows.map((r, i) => {
          const def = B2_STAGE_BY_KEY[r.stage];
          const metaBits = [
            r.examDate ? `Prüfungstermin: ${deDate(r.examDate)}` : null,
            r.cert === "approved" ? "Zertifikat-Dok vorhanden" : r.cert === "pending" ? "Zertifikat-Dok in Prüfung" : "kein Zertifikat-Dok",
            r.failed ? (r.stage === "passed" ? "bestanden nach Wiederholung" : "schon einmal nicht bestanden") : null,
          ].filter(Boolean).join("   ·   ");
          return (
            <View key={i} style={s.row} wrap={false}>
              <View style={s.rowHead}>
                <View style={s.nameWrap}>
                  <View style={[s.dot, { backgroundColor: def.color }]} />
                  <Text style={s.name}>{r.name}</Text>
                  {r.germanLevel ? <Text style={s.level}>{r.germanLevel}</Text> : null}
                </View>
                <Text style={[s.stage, { color: def.color }]}>{statusDe(r.stage)}</Text>
              </View>
              <Text style={r.german ? s.detail : s.detailEmpty}>
                {r.german || "Noch keine B2-Angaben im CV ausgefüllt"}
              </Text>
              <Text style={s.meta}>{metaBits}</Text>
              {i < rows.length - 1 ? <View style={s.sep} /> : null}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}
